import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';

/**
 * 移动抽屉的无障碍回归测试（优化计划 P1-6）。
 *
 * 锁的是替换前那套「条件渲染遮罩 + fixed aside」缺失的四件事：
 *   1. 打开后焦点进入面板（不是留在触发按钮上）
 *   2. Esc 关闭
 *   3. 背景对读屏不可见（aria-hidden）—— 焦点不会落到遮罩后面
 *   4. 关闭后焦点回到触发按钮
 *
 * 这些行为由 Radix 的 modal Dialog 提供，所以测试跑的是真实组件，
 * 不是对 sheet.tsx 里写了什么 class 的假设：哪天有人把 SheetContent
 * 换成非 modal 实现，这四条会一起挂。
 */

function Drawer() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div>
        <span>抽屉外的内容</span>
        {/* 移动端顶栏上的触发器，与 dashboard/layout.tsx 的用法一致 */}
        <SheetTrigger>打开导航菜单</SheetTrigger>
      </div>
      <SheetContent side="left" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>导航</SheetTitle>
        </SheetHeader>
        <nav aria-label="全站导航">
          <a href="/dashboard">课程工作台</a>
          <a href="/dashboard/general">账号设置</a>
        </nav>
        <button type="button">抽屉里的最后一个按钮</button>
      </SheetContent>
    </Sheet>
  );
}

describe('移动抽屉（Sheet）', () => {
  it('打开后焦点进入面板，且面板以「导航」为可访问名', async () => {
    render(<Drawer />);
    const trigger = screen.getByText('打开导航菜单');
    trigger.focus();
    fireEvent.click(trigger);

    // Radix 会在打开后把焦点移到面板内第一个可聚焦元素
    const panel = await screen.findByRole('dialog');
    expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '导航' })).toBeTruthy();
    await waitFor(() => {
      expect(panel.contains(document.activeElement)).toBe(true);
    });
  });

  it('Esc 关闭抽屉', async () => {
    render(<Drawer />);
    fireEvent.click(screen.getByText('打开导航菜单'));
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('打开时背景内容对读屏不可见（焦点不会落到遮罩后）', async () => {
    render(<Drawer />);
    fireEvent.click(screen.getByText('打开导航菜单'));
    await screen.findByRole('dialog');

    // Radix 给 portal 之外的内容加 aria-hidden="true"，屏幕阅读器不能穿到遮罩后面。
    // 注意 queryByText 不认 aria-hidden（它按 DOM 文本查），所以要查可访问性树：
    // 用 role 查询——被 aria-hidden 的子树不会出现在里面。
    const outside = screen.getByText('抽屉外的内容');
    expect(outside.closest('[aria-hidden="true"]')).toBeTruthy();
    // 触发器同样被隔离：（aria-hidden 子树里的 button 不算 role 查询结果）
    expect(screen.queryByRole('button', { name: '打开导航菜单' })).toBeNull();
  });

  it('关闭后焦点回到触发按钮', async () => {
    render(<Drawer />);
    const trigger = screen.getByText('打开导航菜单');
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // 不收回来，键盘用户下一次 Tab 会从页面开头重新数一遍
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});