import { useRef, useState } from 'react';

/**
 * Hook for drag-to-reorder lists using HTML5 native DnD.
 * Items swap live as you drag over them.
 */
export function useDragReorder<T>(items: T[], onChange: (items: T[]) => void) {
  const dragIdx = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const onDragStart = (i: number) => (e: React.DragEvent) => {
    dragIdx.current = i;
    e.dataTransfer.effectAllowed = 'move';
    // Transparent ghost image so we see the live swap instead
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const onDragOver = (i: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    const next = [...items];
    const [item] = next.splice(dragIdx.current, 1);
    next.splice(i, 0, item);
    dragIdx.current = i;
    setOverIdx(i);
    onChange(next);
  };

  const onDragEnd = () => {
    dragIdx.current = null;
    setOverIdx(null);
  };

  return { overIdx, onDragStart, onDragOver, onDragEnd };
}
