import { matchSessions, SEARCH_AFTER } from "@shared/client/sessions.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** How long a primed delete stays primed before it forgets it was ever asked. */
const ARMED_FOR = 5000;

/**
 * The title, while it is being edited.
 *
 * Enter and blur commit, Escape abandons. It owns the draft so that typing does not re-render
 * the list around it, and a ref makes sure the blur that follows Enter or Escape does not
 * commit a second time.
 */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <Input
      // The field only exists because it was just asked for, so it takes the caret.
      autoFocus
      value={value}
      aria-label="Session title"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        finish(event.key === "Enter");
      }}
      className="h-8 text-sm"
    />
  );
}

/** The sessions rail: search, rename in place, and a delete that asks first. */
export function SessionList({ activeId }: { activeId?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  // A row left primed and forgotten is a delete waiting to happen on the next stray click.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARMED_FOR);
    return () => clearTimeout(timer);
  }, [armed]);

  const newChat = useMutation({
    mutationFn: api.createSession,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate({ to: "/chats/$sessionId", params: { sessionId: created.id } });
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameSession(id, title),
    onSuccess: async (_data, { id }) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // The header above the chat reads its title from the session, not from this list.
      await queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (id === activeId) navigate({ to: "/chats" });
    },
  });

  const all = sessions.data ?? [];
  const shown = matchSessions(all, query);

  function commit(id: string, title: string) {
    setEditing(null);
    const trimmed = title.trim();
    const current = all.find((item) => item.id === id)?.title;
    if (trimmed && trimmed !== current) rename.mutate({ id, title: trimmed });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-sidebar">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sessions
        </span>
        <Button size="sm" variant="ghost" onClick={() => newChat.mutate()}>
          <Plus className="size-4" />
          New
        </Button>
      </div>

      {all.length > SEARCH_AFTER ? (
        <div className="px-3 pb-2">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
            className="h-8 text-sm"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.map((item) => (
          <div key={item.id} className="group relative">
            {editing === item.id ? (
              <div className="px-1 py-1">
                <RenameField
                  initial={item.title}
                  onCommit={(title) => commit(item.id, title)}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <Link
                to="/chats/$sessionId"
                params={{ sessionId: item.id }}
                className={cn(
                  "block rounded-md px-3 py-2 pr-16 text-sm hover:bg-accent",
                  item.id === activeId && "bg-accent",
                )}
              >
                <div className="truncate">{item.title}</div>
                <div className="truncate text-xs text-muted-foreground">{when(item.updatedAt)}</div>
              </Link>
            )}

            {/* Hidden until the row is hovered or something in it takes focus, so the list stays
                quiet — but reachable by keyboard, and always shown where there is no hover. */}
            {editing === item.id ? null : (
              <div className="absolute right-1 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                {armed === item.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded bg-destructive px-2 py-1 text-xs font-medium text-white"
                    >
                      Delete?
                    </button>
                    <button
                      type="button"
                      aria-label="Keep this session"
                      onClick={() => setArmed(null)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      aria-label={`Rename ${item.title}`}
                      onClick={() => setEditing(item.id)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${item.title}`}
                      onClick={() => setArmed(item.id)}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {all.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No sessions yet.</p>
        ) : null}
        {all.length > 0 && shown.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No session matches “{query}”.</p>
        ) : null}
      </div>
    </aside>
  );
}
