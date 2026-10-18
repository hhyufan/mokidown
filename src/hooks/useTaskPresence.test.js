import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, cleanup } from '@testing-library/react';
import useTaskPresence from './useTaskPresence';
import useSteadyStatus from './useSteadyStatus';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('holds a completed task briefly and fades it before removal',()=>{
 vi.useFakeTimers();const task={kind:'extension',id:'one',stage:'updating'};
 const {result,rerender}=renderHook(({items})=>useTaskPresence(items),{initialProps:{items:[task]}});
 rerender({items:[]});expect(result.current).toHaveLength(1);
 act(()=>vi.advanceTimersByTime(649));expect(result.current[0].leaving).toBe(false);
 act(()=>vi.advanceTimersByTime(1));expect(result.current[0].leaving).toBe(true);
 act(()=>vi.advanceTimersByTime(220));expect(result.current).toHaveLength(0);
});
it('suppresses very fast busy states and gives a visible spinner a minimum duration',()=>{
 vi.useFakeTimers();const ready={text:'Ready',busy:false},busy={text:'Working',busy:true};
 const {result,rerender}=renderHook(({item})=>useSteadyStatus(item),{initialProps:{item:ready}});
 rerender({item:busy});act(()=>vi.advanceTimersByTime(80));rerender({item:ready});act(()=>vi.advanceTimersByTime(100));expect(result.current.text).toBe('Ready');
 rerender({item:busy});act(()=>vi.advanceTimersByTime(180));expect(result.current.busy).toBe(true);
 rerender({item:ready});act(()=>vi.advanceTimersByTime(449));expect(result.current.busy).toBe(true);
 act(()=>vi.advanceTimersByTime(1));expect(result.current.busy).toBe(false);
});
