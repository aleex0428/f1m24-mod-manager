import { Modal, ModalHeader } from "./Modal";
import { Icon } from "./Icon";

/**
 * The shortcut list, opened with `?`.
 *
 * Keyboard shortcuts that are not written down anywhere are shortcuts nobody
 * uses. This is the one place they are documented, and the palette points at
 * it.
 */
const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Anywhere",
    items: [
      ["Ctrl + K", "Command palette — search mods and run any action"],
      ["Ctrl + F", "Jump to the search box"],
      ["Ctrl + J", "Open the downloads panel"],
      ["Ctrl + B", "Collapse or expand the sidebar"],
      ["?", "This list"],
      ["Esc", "Close whatever is open"],
    ],
  },
  {
    title: "Navigation",
    items: [
      ["Ctrl + 1", "My Mods"],
      ["Ctrl + 2", "Browse"],
      ["Ctrl + 3", "Settings"],
      ["Ctrl + ,", "Settings"],
    ],
  },
  {
    title: "My Mods",
    items: [
      ["Ctrl + R", "Sync the catalogue (on Browse)"],
      ["Ctrl + A", "Select every visible mod"],
      ["Shift + click", "Select a range of mods"],
      ["Right click", "Actions for a mod"],
    ],
  },
];

export function ShortcutsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" size="max-w-lg">
      <ModalHeader
        title="Keyboard shortcuts"
        onClose={onClose}
        icon={
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-bg-elevated text-text-secondary">
            <Icon name="keyboard" size={18} />
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {GROUPS.map((group) => (
          <section key={group.title} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
              {group.title}
            </h3>
            <dl className="divide-y divide-border-subtle">
              {group.items.map(([keys, description]) => (
                <div key={keys} className="flex items-center gap-4 py-2">
                  <dt className="flex w-32 flex-shrink-0 gap-1">
                    {keys.split(" + ").map((key) => (
                      <span key={key} className="kbd">
                        {key}
                      </span>
                    ))}
                  </dt>
                  <dd className="text-sm text-text-secondary">{description}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
