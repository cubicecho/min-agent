import { Children, createContext, type ReactNode, useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { IconClassContext } from "@/components/ui/icons-base";
import {
  TABS_LIST_CLASS,
  TABS_TRIGGER_CLASS,
  TABS_TRIGGER_TEXT_CLASS,
  type TabsContentProps,
  type TabsListProps,
  type TabsProps,
  type TabsTriggerProps,
} from "@/components/ui/tabs-base";
import { cn } from "@/lib/utils";

type TabsState = { value: string; setValue: (value: string) => void };

const TabsContext = createContext<TabsState>({ value: "", setValue: () => {} });

function Tabs({ value: controlled, onValueChange, defaultValue, className, children }: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const value = controlled ?? uncontrolled;
  const setValue = (next: string) => {
    if (controlled === undefined) setUncontrolled(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <View className={cn(className)}>{children}</View>
    </TabsContext.Provider>
  );
}

function TabsList({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
  children,
}: TabsListProps) {
  // A `tab` outside a `tablist` is an orphan to a screen reader, and axe says so.
  return (
    <View
      role="tablist"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn("flex-row", TABS_LIST_CLASS, className)}
    >
      {children}
    </View>
  );
}

/**
 * A trigger's children with each run of strings and numbers in one `<Text>`,
 * and anything else (an icon, a badge) beside it in the row. An SVG is not
 * valid inside a `<Text>` on device, and a run is kept whole so `{count} open`
 * stays one label rather than two pieces spaced apart by the row's gap.
 */
function label(children: ReactNode, className: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let run: (string | number)[] = [];
  const flush = () => {
    if (run.length === 0) return;
    parts.push(
      <Text key={`text-${parts.length}`} className={className}>
        {run.join("")}
      </Text>,
    );
    run = [];
  };
  for (const child of Children.toArray(children)) {
    if (typeof child === "string" || typeof child === "number") run.push(child);
    else {
      flush();
      parts.push(child);
    }
  }
  flush();
  return parts;
}

function TabsTrigger({ value, disabled = false, className, children }: TabsTriggerProps) {
  const tabs = useContext(TabsContext);
  const active = tabs.value === value;
  const color = active ? "text-selection-foreground" : "text-muted-foreground";
  return (
    <Pressable
      role="tab"
      aria-selected={active}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => tabs.setValue(value)}
      className={cn(
        TABS_TRIGGER_CLASS,
        active ? "bg-selection" : "hover:bg-accent",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* Text colour does not inherit on native, so the active/inactive split
          lands on each `<Text>` and, through the context, on each icon — the
          container's colour reaches neither. */}
      <IconClassContext.Provider value={cn("size-4 shrink-0", color)}>
        {label(children, cn(TABS_TRIGGER_TEXT_CLASS, color))}
      </IconClassContext.Provider>
    </Pressable>
  );
}

function TabsContent({ value, className, children }: TabsContentProps) {
  const tabs = useContext(TabsContext);
  if (tabs.value !== value) return null;
  return <View className={cn("mt-2", className)}>{children}</View>;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
