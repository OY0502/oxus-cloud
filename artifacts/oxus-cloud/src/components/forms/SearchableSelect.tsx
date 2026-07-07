import React, { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
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

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Optional sticky action shown at the bottom of the dropdown. */
  footerLabel?: string;
  onFooterClick?: () => void;
  className?: string;
  disabled?: boolean;
  /** Use when rendered inside a modal dialog so scroll and stacking behave correctly. */
  inModal?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  footerLabel,
  onFooterClick,
  className,
  disabled,
  inModal = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={inModal}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          "w-[--radix-popover-trigger-width] p-0",
          inModal && "z-[200]",
        )}
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList
            className="max-h-[min(280px,var(--radix-popover-content-available-height))]"
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="overflow-visible">
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.sublabel ?? ""} ${o.value}`}
                  onSelect={() => {
                    onChange(o.value === value ? "" : o.value);
                    setOpen(false);
                  }}
                  className="gap-2 aria-selected:bg-muted aria-selected:text-foreground data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
                >
                  <Check className={cn("h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{o.label}</span>
                    {o.sublabel && <span className="text-xs text-muted-foreground truncate">{o.sublabel}</span>}
                  </div>
                </CommandItem>
              ))}
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
