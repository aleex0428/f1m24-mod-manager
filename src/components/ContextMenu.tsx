import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface MenuAction {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item. */
  separatorBefore?: boolean;
  /** Right-aligned hint, e.g. "Ctrl+D". */
  hint?: string;
}

export interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Right-click menu.
 *
 * Positioned against the viewport and flipped when it would open past an edge,
 * because the last row of a full-height list is exactly where people
 * right-click and exactly where a naive menu renders off screen.
 */
export function ContextMenu({
  position,
  items,
  onClose,
}: {
  position: MenuPosition;
  items: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(position);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectable = items.filter((i) => !i.disabled);

  // Flip before paint so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    setPlaced({
      x: Math.min(position.x, window.innerWidth - width - margin),
      y: Math.min(position.y, window.innerHeight - height - margin),
    });
  }, [position]);

  useEffect(() => {
    const dismiss = () => onClose();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const step = e.key === "ArrowDown" ? 1 : -1;
          const count = selectable.length;
          if (count === 0) return -1;
          return (prev + step + count) % count;
        });
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        const item = selectable[activeIndex];
        if (item) {
          onClose();
          item.onSelect();
        }
      }
    };

    // `mousedown` rather than `click`: the menu must be gone before the click
    // that dismissed it lands on whatever is underneath.
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, activeIndex, selectable]);

  return (
    <div
      ref={ref}
      role="menu"
      className="menu fixed z-menu animate-scale-in"
      style={{ left: placed.x, top: placed.y, transformOrigin: "top left" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => (
        <div key={item.label}>
          {item.separatorBefore && <div className="menu-separator" role="separator" />}
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            onMouseEnter={() => setActiveIndex(selectable.indexOf(item))}
            className={`menu-item ${item.danger ? "menu-item-danger" : ""} ${
              !item.disabled && selectable[activeIndex] === item ? "bg-surface-overlay text-text-primary" : ""
            }`}
            data-index={index}
          >
            {item.icon && <Icon name={item.icon} size={15} />}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && <span className="kbd">{item.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Wires a right-click to a menu. Returns the handler to put on the row and the
 * element to render (null while closed).
 */
export function useContextMenu() {
  const [state, setState] = useState<{ position: MenuPosition; items: MenuAction[] } | null>(null);

  const open = useCallback((event: React.MouseEvent, items: MenuAction[]) => {
    event.preventDefault();
    event.stopPropagation();
    setState({ position: { x: event.clientX, y: event.clientY }, items });
  }, []);

  const close = useCallback(() => setState(null), []);

  const element = state ? (
    <ContextMenu position={state.position} items={state.items} onClose={close} />
  ) : null;

  return { open, close, element, isOpen: state !== null };
}
