"""贡献归因计算（共桨 M6 / 规格书 S4.7）。

铁律：系统永不输出单一分数——输出区间 + 置信度 + 可下钻证据 + 提示，
终审权与调分权归教师（规格书 S4.7「为什么坚决不输出分数」）。

三类证据（全部由系统沉淀的数据算出，不用大模型）：
  A 产出物：段落级归属统计（主责全权、协作半权）
  B 过程：按期率 / 关键路径信用 / 返工惩罚 / 补位信用
  C 同伴：互评去极值中位数（5 分制映射 0–1）
缺失处理：本轮无互评数据时，同伴权重按 0.5 : 0.3 重分配给产出物/过程，
并在响应里标记 peer_missing（账本标注「缺同伴证据，区间已放宽」）。
"""

from __future__ import annotations

from ..schemas import (
    AttributionComputeRequest,
    AttributionComputeResponse,
    AttributionMemberResult,
)

# 区间宽度系数与封顶（规格书 S4.7）
UNCERTAINTY_SCALE = 6.0
MAX_SPREAD = 8.0


def _peer_median(scores: list[float]) -> float | None:
    """去极值中位数：人数 ≥ 4 时去掉最高最低各一个；< 4 直接取中位数。"""
    if not scores:
        return None
    s = sorted(scores)
    if len(s) >= 4:
        s = s[1:-1]
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return s[mid]
    return (s[mid - 1] + s[mid]) / 2


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 == 1 else (s[mid - 1] + s[mid]) / 2


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5


def compute_attribution(req: AttributionComputeRequest) -> AttributionComputeResponse:
    members = req.members
    if not members:
        return AttributionComputeResponse(members=[], peer_missing=False)

    n = len(members)
    fair_share = 100.0 / n  # 应分担份额

    # 同伴证据是否整体缺席（无人收到任何评分）
    peer_missing = all(not m.peer_scores for m in members)

    # ---- 证据 A·产出物 ----
    w_main = {m.user_id: float(m.words_authored) for m in members}
    w_coop = {m.user_id: 0.5 * float(m.words_revised) for m in members}
    w_total = {uid: w_main[uid] + w_coop[uid] for uid in w_main}
    sum_total = sum(w_total.values())

    # ---- 证据 B·过程 ----
    # 无主责任务的成员不参与过程证据（证据缺失不贡献，与互评缺席处理一致），
    # 避免 rework_penalty 的默认满分给「零过程数据」者发底分。
    p_raw: dict[str, float] = {}
    for m in members:
        if m.lead_total <= 0 and m.cp_total <= 0 and m.help_count <= 0:
            p_raw[m.user_id] = 0.0
            continue
        on_time_rate = m.lead_on_time / m.lead_total if m.lead_total > 0 else 0.0
        cp_credit = m.cp_done / m.cp_total if m.cp_total > 0 else 0.0
        rework_penalty = 1 - min(1.0, m.rework_count / (2 * m.lead_total)) if m.lead_total > 0 else 1.0
        help_credit = min(1.0, m.help_count / 3)
        p_raw[m.user_id] = 0.35 * on_time_rate + 0.30 * cp_credit + 0.20 * rework_penalty + 0.15 * help_credit
    sum_p = sum(p_raw.values())

    # ---- 证据 C·同伴 ----
    peer_raw: dict[str, float] = {}
    for m in members:
        median = _peer_median(m.peer_scores)
        peer_raw[m.user_id] = None if median is None else max(0.0, (median - 1) / 4)
    sum_peer = sum(v for v in peer_raw.values() if v is not None)

    # ---- 权重（同伴缺失时按 0.5 : 0.3 重分配）----
    w_a, w_p, w_peer = req.w_artifact, req.w_process, req.w_peer
    if peer_missing and sum_peer == 0:
        total_ap = w_a + w_p
        if total_ap > 0:
            w_a, w_p = w_a / total_ap, w_p / total_ap
        w_peer = 0.0

    # ---- 点估计与构成 ----
    results: list[AttributionMemberResult] = []
    raw: dict[str, dict[str, float]] = {}
    for m in members:
        uid = m.user_id
        a_score = 100 * w_total[uid] / sum_total if sum_total > 0 else 0.0
        p_score = 100 * p_raw[uid] / sum_p if sum_p > 0 else 0.0
        peer_score = 100 * peer_raw[uid] / sum_peer if sum_peer > 0 else 0.0
        point = w_a * a_score + w_p * p_score + w_peer * peer_score

        # 构成（占 point 的百分比；过程证据拆为 按时交付/审阅返工/主动补位）
        on_time_rate = m.lead_on_time / m.lead_total if m.lead_total > 0 else 0.0
        cp_credit = m.cp_done / m.cp_total if m.cp_total > 0 else 0.0
        rework_penalty = 1 - min(1.0, m.rework_count / (2 * m.lead_total)) if m.lead_total > 0 else 1.0
        help_credit = min(1.0, m.help_count / 3)
        on_time_part = p_score * 0.35 * on_time_rate + p_score * 0.30 * cp_credit
        rework_part = p_score * 0.20 * rework_penalty
        help_part = p_score * 0.15 * help_credit
        main_part = w_a * a_score * (w_main[uid] / w_total[uid]) if w_total[uid] > 0 else 0.0
        coop_part = w_a * a_score * (w_coop[uid] / w_total[uid]) if w_total[uid] > 0 else 0.0

        raw[uid] = {
            "主责产出": main_part,
            "协作产出": coop_part,
            "按时交付": on_time_part,
            "审阅返工": rework_part,
            "主动补位": help_part,
            "_peer": w_peer * peer_score,
        }

        results.append(
            AttributionMemberResult(
                user_id=uid,
                point=point,
                low=point,
                high=point,
                fair_share_ratio=point / fair_share if fair_share > 0 else 0.0,
                comp={},
            )
        )

    # ---- 区间估计（证据充分度 × 互评一致性）----
    avg_words = sum(w_main.values()) / n
    avg_lead = sum(m.lead_total for m in members) / n
    peer_medians = {m.user_id: _peer_median(m.peer_scores) for m in members}
    median_values = [v for v in peer_medians.values() if v is not None]

    for res, m in zip(results, members, strict=True):
        uid = m.user_id
        coverage = min(
            w_main[uid] / avg_words if avg_words > 0 else 1.0,
            m.lead_total / avg_lead if avg_lead > 0 else 1.0,
            1.0,
        )
        if len(median_values) >= 2:
            med = _median(median_values)
            std = _std(median_values)
            agreement = 1 - (std / med) if med > 0 else 0.0
        else:
            agreement = 0.0 if median_values else 1.0
        agreement = max(0.0, min(1.0, agreement))

        uncertainty = UNCERTAINTY_SCALE * (1 - coverage) * (1 - agreement)
        low = res.point - uncertainty
        high = min(res.point + uncertainty, res.point + MAX_SPREAD)
        res.low = low
        res.high = high

        if coverage >= 0.7 and agreement >= 0.7:
            res.confidence = "high"
        elif coverage >= 0.4 and agreement >= 0.4:
            res.confidence = "medium"
        else:
            res.confidence = "low"

        # 搭便车提示（阈值来自实证研究；必须同时说明不构成扣分依据）
        if res.fair_share_ratio < req.fair_share_threshold:
            res.warning = (
                f"贡献低于组内应分担份额的 {req.fair_share_threshold:.0%}。"
                "注意：实证研究表明贡献不均与团队成绩无稳定关联，本提示仅供教师参考，不构成扣分依据。"
            )

        # 构成归一化（含同伴证据部分单列）
        parts = dict(raw[uid])
        peer_part = parts.pop("_peer")
        total_parts = sum(parts.values()) + peer_part
        if total_parts > 0:
            comp = {k: round(v / total_parts * 100, 1) for k, v in parts.items() if v > 0}
            if peer_part > 0:
                comp["同伴评价"] = round(peer_part / total_parts * 100, 1)
            res.comp = comp

    return AttributionComputeResponse(members=results, peer_missing=peer_missing)
