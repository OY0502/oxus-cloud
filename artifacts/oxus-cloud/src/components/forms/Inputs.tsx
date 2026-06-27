import React, { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { enGB } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatAmount, parseAmount, isValidEmail } from "@/lib/validation";
import { CURRENCY_SYMBOL } from "@/lib/currency";

// ---------------------------------------------------------------------------
// CurrencyInput — displays a grouped amount ("1,000.00") and emits a number.
// ---------------------------------------------------------------------------
export function CurrencyInput({
  value,
  onChange,
  placeholder = "0.00",
  className,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const display = focused ? draft : value != null ? formatAmount(value) : "";

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
        {CURRENCY_SYMBOL}
      </span>
      <Input
        inputMode="decimal"
        className={cn("pl-7", className)}
        value={display}
        placeholder={placeholder}
        onFocus={() => {
          setFocused(true);
          setDraft(value != null ? String(value) : "");
        }}
        onBlur={() => {
          setFocused(false);
          onChange(parseAmount(draft));
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          onChange(parseAmount(raw));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TagInput — wraps committed values as removable chips. Commit on Enter or
// when a comma is typed.
// ---------------------------------------------------------------------------
export function TagInput({
  value,
  onChange,
  placeholder = "Add a tag…",
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const next = raw.trim().replace(/,$/, "").trim();
    if (next && !value.includes(next)) onChange([...value, next]);
    setDraft("");
  };

  const handleChange = (raw: string) => {
    if (raw.includes(",")) {
      const parts = raw.split(",");
      const last = parts.pop() ?? "";
      let acc = [...value];
      for (const p of parts) {
        const t = p.trim();
        if (t && !acc.includes(t)) acc = [...acc, t];
      }
      onChange(acc);
      setDraft(last);
    } else {
      setDraft(raw);
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((t) => t !== tag));
            }}
            className="rounded-full p-0.5 hover:bg-primary/20"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[6rem] bg-transparent outline-none placeholder:text-muted-foreground"
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// DatePicker — popover calendar styled to match the app. Stores ISO yyyy-MM-dd.
// ---------------------------------------------------------------------------
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selected ? format(selected, "PP") : placeholder}</span>
          <span className="ml-2 flex items-center gap-1">
            {selected && (
              <X
                className="h-3.5 w-3.5 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              />
            )}
            <CalendarIcon className="h-4 w-4 opacity-50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto min-w-[320px] p-0 rounded-xl" align="start" sideOffset={6}>
        <Calendar
          mode="single"
          selected={selected}
          captionLayout="dropdown"
          weekStartsOn={1}
          locale={enGB}
          className="min-w-[320px] p-3"
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : null);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// EmailInput — inline email validity feedback.
// ---------------------------------------------------------------------------
export function EmailInput({
  value,
  onChange,
  placeholder = "name@company.com",
  className,
  onValidityChange,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [touched, setTouched] = useState(false);
  const invalid = value.trim() !== "" && !isValidEmail(value);

  useEffect(() => {
    onValidityChange?.(value.trim() === "" || isValidEmail(value));
  }, [value, onValidityChange]);

  return (
    <div className="space-y-1">
      <Input
        type="email"
        value={value}
        placeholder={placeholder}
        className={cn(invalid && touched && "border-destructive focus-visible:ring-destructive", className)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      {invalid && touched && (
        <p className="text-xs text-destructive">Enter a valid email address.</p>
      )}
    </div>
  );
}
