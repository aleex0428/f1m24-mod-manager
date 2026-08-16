import { NavLink } from "react-router-dom";
import { useModStore } from "../store/modStore";
import { linkOvertakeAccount } from "../lib/auth";
import { Icon, type IconName } from "./Icon";

const navItems: { path: string; label: string; icon: IconName; hint: string }[] = [
  { path: "/library", label: "My Mods", icon: "library", hint: "Ctrl+1" },
  { path: "/browse", label: "Browse", icon: "browse", hint: "Ctrl+2" },
  { path: "/settings", label: "Settings", icon: "settings", hint: "Ctrl+3" },
];

/**
 * Collapsing the sidebar is not decoration: at 228px it takes a fifth of the
 * width of a small window, which is exactly the column the catalogue grid
 * needs to fit another card. Folded, it keeps the icons and the active marker,
 * so nothing is lost but the labels.
 */
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const isLoggedIn = useModStore((s) => s.isLoggedIn);
  const appVersion = useModStore((s) => s.appVersion);
  const modCount = useModStore((s) => s.mods.length);
  const updateAvailable = useModStore((s) => s.appUpdate.stage === "available");

  return (
    <aside
      className={`relative z-10 flex h-full flex-shrink-0 flex-col border-r border-border/70 bg-bg-secondary/80 transition-[width] duration-slow ease-out-expo ${
        collapsed ? "w-[68px]" : "w-[228px]"
      }`}
    >
      {/* Brand */}
      <div
        className={`titlebar flex items-center py-[18px] ${
          collapsed ? "justify-center px-3" : "gap-3 px-5"
        }`}
      >
        <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-f1red to-f1red-dark shadow-f1">
          <span className="font-display text-lg font-black leading-none text-white">F1</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-display text-sm font-bold leading-tight tracking-wide text-text-primary">
              MOD MANAGER
            </p>
            <p className="text-2xs leading-tight text-text-muted">F1 Manager 24</p>
          </div>
        )}
      </div>

      <div
        className={`h-px bg-gradient-to-r from-f1red/40 via-border to-transparent ${
          collapsed ? "mx-3" : "mx-5"
        }`}
      />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            title={collapsed ? `${item.label} · ${item.hint}` : undefined}
            className={({ isActive }) =>
              `group relative flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors duration-fast ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              } ${
                isActive
                  ? "bg-f1red/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface/70 hover:text-text-primary"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-f1red transition-opacity duration-fast ${
                    isActive ? "opacity-100" : "opacity-0"
                  }`}
                />
                <Icon
                  name={item.icon}
                  size={18}
                  className={isActive ? "text-f1red" : "text-text-muted group-hover:text-text-secondary"}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.path === "/library" && modCount > 0 && (
                      <span className="rounded-md bg-surface-overlay px-1.5 py-0.5 font-mono text-2xs text-text-secondary">
                        {modCount}
                      </span>
                    )}
                  </>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Account status */}
      <div className="px-3 pb-3">
        <button
          onClick={() => {
            if (!isLoggedIn) linkOvertakeAccount();
          }}
          disabled={isLoggedIn}
          title={
            collapsed
              ? isLoggedIn
                ? "Overtake.gg linked — downloads enabled"
                : "Not linked — click to sign in"
              : undefined
          }
          className={`w-full rounded-xl border text-left transition-colors duration-fast ${
            collapsed ? "flex justify-center px-0 py-2.5" : "px-3 py-2.5"
          } ${
            isLoggedIn
              ? "cursor-default border-success/20 bg-success/5"
              : "border-border bg-surface/60 hover:border-f1red/40 hover:bg-surface-raised"
          }`}
        >
          {collapsed ? (
            <span
              className={`h-2 w-2 rounded-full ${isLoggedIn ? "bg-success" : "bg-text-muted"}`}
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    isLoggedIn ? "bg-success" : "bg-text-muted"
                  }`}
                />
                <span
                  className={`text-2xs font-semibold uppercase tracking-wider ${
                    isLoggedIn ? "text-success" : "text-text-secondary"
                  }`}
                >
                  {isLoggedIn ? "Overtake linked" : "Not linked"}
                </span>
              </div>
              <p className="mt-0.5 pl-3.5 text-2xs leading-tight text-text-muted">
                {isLoggedIn ? "Downloads enabled" : "Click to sign in"}
              </p>
            </>
          )}
        </button>
      </div>

      <div
        className={`flex items-center gap-2 border-t border-border-subtle py-2 ${
          collapsed ? "flex-col px-2" : "px-3"
        }`}
      >
        <button
          onClick={onToggle}
          className="btn-icon-sm"
          title={collapsed ? "Expand the sidebar (Ctrl+B)" : "Collapse the sidebar (Ctrl+B)"}
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? "chevron-right" : "panel-left"} size={16} />
        </button>

        {!collapsed &&
          (updateAvailable ? (
            <NavLink
              to="/settings"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1 text-2xs font-semibold text-f1red transition-colors hover:bg-f1red/10"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-f1red" />
              Update available
            </NavLink>
          ) : (
            <p className="flex-1 text-center font-mono text-2xs text-text-muted">v{appVersion}</p>
          ))}

        {collapsed && updateAvailable && (
          <NavLink to="/settings" title="Update available" className="py-1">
            <span className="block h-1.5 w-1.5 rounded-full bg-f1red" />
          </NavLink>
        )}
      </div>
    </aside>
  );
}
