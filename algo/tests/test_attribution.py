"""贡献归因测试（规格书 S4.7 / S9.3 断言）。"""

import pytest
from pydantic import ValidationError

from app.algorithms.attribution import compute_attribution
from app.schemas import AttributionComputeRequest, AttributionMemberInput


def make_request(members: list[AttributionMemberInput], **kwargs) -> AttributionComputeRequest:
    return AttributionComputeRequest(group_id="g1", members=members, **kwargs)


def test_two_members_artifact_only() -> None:
    """两人只按产出物（无过程/同伴数据）：字数比 3:1 → point 比 75:25。

    同伴缺席时权重按 0.5:0.3 重分配给产出物/过程，绝对值为 46.9/15.6，
    但产出物证据决定了 75:25 的比例。
    """
    members = [
        AttributionMemberInput(user_id="u1", words_authored=3000),
        AttributionMemberInput(user_id="u2", words_authored=1000),
    ]
    res = compute_attribution(make_request(members))
    u1, u2 = res.members
    total = u1.point + u2.point
    assert u1.point / total == pytest.approx(0.75, abs=0.01)
    assert u2.point / total == pytest.approx(0.25, abs=0.01)
    assert res.peer_missing is True
    # 区间包含点估计，且宽度有上限
    assert u1.low <= u1.point <= u1.high
    assert u1.high - u1.low <= 8.0
    # 构成只含产出物证据
    assert u1.comp == {"主责产出": 100.0}


def test_cooperation_half_weight() -> None:
    """协作产出按主责半权计：主责 1000 字 vs 修改他人 2000 字 → 持平。"""
    members = [
        AttributionMemberInput(user_id="u1", words_authored=1000),
        AttributionMemberInput(user_id="u2", words_revised=2000),  # 2000×0.5 = 1000
    ]
    res = compute_attribution(make_request(members))
    u1, u2 = res.members
    assert u1.point == pytest.approx(u2.point, abs=0.5)
    assert u2.comp == {"协作产出": 100.0}
    assert u1.comp == {"主责产出": 100.0}


def test_peer_evidence_shifts_points() -> None:
    """互评拉高低产出成员的点估计。"""
    members = [
        AttributionMemberInput(
            user_id="u1", words_authored=3000, lead_total=2, lead_on_time=2, peer_scores=[5, 5, 4, 5]
        ),
        AttributionMemberInput(
            user_id="u2", words_authored=1000, lead_total=2, lead_on_time=0, peer_scores=[2, 2, 3, 2]
        ),
    ]
    res = compute_attribution(make_request(members))
    u1, u2 = res.members
    assert u1.point > u2.point
    assert res.peer_missing is False
    assert "同伴评价" in u1.comp


def test_peer_missing_redistributes_weights() -> None:
    """无互评数据：peer_missing=true，权重重分配后产出物主导。"""
    members = [
        AttributionMemberInput(user_id="u1", words_authored=1000),
        AttributionMemberInput(user_id="u2", words_authored=1000),
    ]
    res = compute_attribution(make_request(members))
    assert res.peer_missing is True
    for m in res.members:
        assert "同伴评价" not in m.comp
        # 无过程数据时区间应放宽（coverage 低）
        assert m.high - m.low >= 0


def test_interval_widens_without_evidence() -> None:
    """证据充分度低 → 区间更宽（诚实表达不确定性）。"""
    rich = AttributionMemberInput(
        user_id="u1",
        words_authored=2000,
        lead_total=4,
        lead_on_time=4,
        cp_total=4,
        cp_done=3,
        peer_scores=[4, 4, 5, 4],
    )
    poor = AttributionMemberInput(
        user_id="u2",
        words_authored=200,
        lead_total=1,
        lead_on_time=0,
        cp_total=4,
        cp_done=0,
        peer_scores=[2],
    )
    res = compute_attribution(make_request([rich, poor]))
    r1, r2 = res.members[0], res.members[1]
    assert r1.high - r1.low < r2.high - r2.low
    assert r1.confidence in ("high", "medium")
    assert r2.confidence == "low"


def test_free_rider_threshold_warning() -> None:
    """综合贡献 < 14% 应分担份额 → 提示，且文案含「不构成扣分依据」。"""
    members = [
        AttributionMemberInput(user_id="u1", words_authored=9000, lead_total=4, lead_on_time=4, cp_total=4, cp_done=4),
        AttributionMemberInput(user_id="u2", words_authored=100),
    ]
    res = compute_attribution(make_request(members))
    u2 = res.members[1]
    assert u2.fair_share_ratio < 0.14
    assert u2.warning
    assert "不构成扣分依据" in u2.warning
    # 高于阈值不提示
    assert res.members[0].warning == ""


def test_never_outputs_single_score() -> None:
    """铁律：任何结果都必须有区间；且 low ≤ point ≤ high。"""
    members = [
        AttributionMemberInput(user_id=f"u{i}", words_authored=i * 500, lead_total=i, lead_on_time=i)
        for i in range(1, 5)
    ]
    res = compute_attribution(make_request(members))
    for m in res.members:
        assert m.low <= m.point <= m.high
        assert m.high - m.low <= 8.0


def test_rework_and_help_affect_process() -> None:
    """返工降分、补位加分。"""
    base = dict(words_authored=1000, lead_total=4, lead_on_time=4, cp_total=4, cp_done=2)
    steady = AttributionMemberInput(user_id="u1", **base)
    reworked = AttributionMemberInput(user_id="u2", rework_count=8, **base)
    helper = AttributionMemberInput(user_id="u3", help_count=3, **base)
    res = compute_attribution(make_request([steady, reworked, helper]))
    by_id = {m.user_id: m for m in res.members}
    assert by_id["u3"].point > by_id["u1"].point > by_id["u2"].point


def test_weight_validation() -> None:
    """权重超出 0-1 被 pydantic 拒绝。"""
    with pytest.raises(ValidationError):
        AttributionComputeRequest(group_id="g1", members=[], w_artifact=1.5)
