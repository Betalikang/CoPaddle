'use client';

import { useEffect, useState } from 'react';

/**
 * 是否已完成首次挂载（客户端渲染）。
 *
 * 服务端不知道当前用户在某门课里的角色，若在 SSR 阶段就按「角色未知」渲染占位、
 * 客户端拿到数据后立刻按角色渲染，React 会报 hydration mismatch 并整棵树重建。
 * 用这个 hook 把「依赖客户端数据的部分」推迟到挂载之后，首帧服务端与客户端一致。
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
