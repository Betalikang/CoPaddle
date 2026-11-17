import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * 组件测试的公共准备。
 *
 * 和 Next 无关：这里渲染的是普通 React 组件（客户端组件），
 * 所以不需要 next/jest 那套 transform，也不需要 mock next/navigation 之外的框架能力。
 */

// React 19 的 act() 依赖这个全局标记；@testing-library/react 在非 jest 环境下不会自己设。
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});