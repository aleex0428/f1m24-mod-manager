import { NavLink } from "react-router-dom";
import { useModStore } from "../store/modStore";
import { linkOvertakeAccount } from "../lib/auth";

const navItems = [
  {
    path: "/library",
    label: "My Mods",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.6}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
        />
      </svg>
    ),
  },
  {
    path: "/browse",
    label: "Browse",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.6}
          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
        />
      </svg>
    ),
  },
  {
    path: "/settings",
    label: "Settings",
    icon: (
      <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.6}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const isLoggedIn = useModStore((s) => s.isLoggedIn);
  const appVersion = useModStore((s) => s.appVersion);
  const modCount = useModStore((s) => s.mods.length);
  const updateAvailable = useModStore((s) => s.appUpdate.stage === "available");

  return (
    <aside className="relative z-10 flex h-full w-[228px] flex-shrink-0 flex-col border-r border-border/70 bg-bg-secondary/80">
      {/* Brand */}
      <div className="titlebar flex items-center gap-3 px-5 py-[18px]">
        <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-f1red to-f1red-dark shadow-f1">
          <span className="font-display text-lg font-black leading-none text-white">F1</span>
        </div>
        <div className="min-w-0">
          <p className="font-display text-sm font-bold leading-tight tracking-wide text-text-primary">
            MOD MANAGER
          </p>
          <p className="text-[11px] leading-tight text-text-muted">F1 Manager 24</p>
        </div>
      </div>

      <div className="mx-5 h-px bg-gradient-to-r from-f1red/40 via-border to-transparent" />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-f1red/10 text-text-primary"
                  : "text-text-secondary hover:bg-surface/70 hover:text-text-primary"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-f1red transition-opacity duration-150 ${
                    isActive ? "opacity-100" : "opacity-0"
                  }`}
                />
                <span className={isActive ? "text-f1red" : "text-text-muted group-hover:text-text-secondary"}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.path === "/library" && modCount > 0 && (
                  <span className="rounded-md bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                    {modCount}
                  </span>
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
          className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
            isLoggedIn
              ? "cursor-default border-success/20 bg-success/5"
              : "border-border bg-surface/60 hover:border-f1red/40 hover:bg-surface-raised"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                isLoggedIn ? "bg-success" : "bg-text-muted"
              }`}
            />
            <span
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                isLoggedIn ? "text-success" : "text-text-secondary"
              }`}
            >
              {isLoggedIn ? "Overtake linked" : "Not linked"}
            </span>
          </div>
          <p className="mt-0.5 pl-3.5 text-[11px] leading-tight text-text-muted">
            {isLoggedIn ? "Downloads enabled" : "Click to sign in"}
          </p>
        </button>
      </div>

      <div className="border-t border-border-subtle px-5 py-3">
        {updateAvailable ? (
          <NavLink
            to="/settings"
            className="flex items-center justify-center gap-1.5 rounded-lg py-1 text-[11px] font-semibold text-f1red transition-colors hover:bg-f1red/10"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-f1red" />
            Update available
          </NavLink>
        ) : (
          <p className="text-center font-mono text-[10px] text-text-muted">v{appVersion}</p>
        )}
      </div>
    </aside>
  );
}
