import React, { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import type { SearchableOption } from "./SearchableSelect";

const commandItemClass =
  "gap-2 aria-selected:bg-muted aria-selected:text-foreground data-[selected=true]:bg-muted data-[selected=true]:text-foreground";

interface SearchableMultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  footerLabel?: string;
  onFooterClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function SearchableMultiSelect({
  values,
  onChange,
  options,
  placeholder = "Select people…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  footerLabel,
  onFooterClick,
  className,
  disabled,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.filter((o) => values.includes(o.value)), [options, values]);

  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  };

  const remove = (id: string) => onChange(values.filter((v) => v !== id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm transition-colors",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            selected.length === 0 && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex flex-1 flex-wrap items-center gap-1.5 min-w-0">
            {selected.length === 0 ? (
              <span className="px-1 truncate">{placeholder}</span>
            ) : (
              selected.map((o) => (
                <Badge
                  key={o.value}
                  variant="secondary"
                  className="gap-1 bg-muted font-normal text-foreground hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(o.value);
                  }}
                >
                  {o.label}
                  <X className="h-3 w-3 opacity-60" />
                </Badge>
              ))
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const picked = values.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.sublabel ?? ""}`}
                    onSelect={() => toggle(o.value)}
                    className={commandItemClass}
                  >
                    <Check className={cn("h-4 w-4", picked ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{o.label}</span>
                      {o.sublabel && <span className="text-xs text-muted-foreground truncate">{o.sublabel}</span>}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {footerLabel && onFooterClick && (
            <>
              <CommandSeparator />
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onFooterClick();
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm font-medium text-primary hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                  {footerLabel}
                </button>
              </div>
            </>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
