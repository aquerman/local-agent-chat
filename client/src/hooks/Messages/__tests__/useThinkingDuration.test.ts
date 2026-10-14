import { renderHook, act } from '@testing-library/react';
import useThinkingDuration from '../useThinkingDuration';

describe('useThinkingDuration', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports whole seconds once thinking stops', () => {
    jest.setSystemTime(new Date('2026-10-14T10:00:00Z'));
    const { result, rerender } = renderHook(
      ({ thinking }) => useThinkingDuration('msg-1:0', thinking),
      { initialProps: { thinking: true } },
    );
    expect(result.current).toBeNull();
    act(() => {
      jest.setSystemTime(new Date('2026-10-14T10:00:12.400Z'));
    });
    rerender({ thinking: false });
    expect(result.current).toBe(12);
  });

  it('never reports 0 seconds', () => {
    const { result, rerender } = renderHook(
      ({ thinking }) => useThinkingDuration('msg-2:0', thinking),
      { initialProps: { thinking: true } },
    );
    rerender({ thinking: false });
    expect(result.current).toBe(1);
  });

  it('returns null for a thought it never saw start (page reload)', () => {
    const { result } = renderHook(() => useThinkingDuration('msg-3:0', false));
    expect(result.current).toBeNull();
  });

  it('survives a remount with the same key', () => {
    const first = renderHook(({ thinking }) => useThinkingDuration('msg-4:0', thinking), {
      initialProps: { thinking: true },
    });
    first.rerender({ thinking: false });
    const value = first.result.current;
    first.unmount();
    const second = renderHook(() => useThinkingDuration('msg-4:0', false));
    expect(second.result.current).toBe(value);
  });
});
