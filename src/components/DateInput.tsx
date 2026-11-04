"use client";

import { useRef, type InputHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> & {
  value: string;
  type?: "date" | "datetime-local";
};

/** 中文日期按钮打开浏览器的日历。 */
export function DateInput({ value, type = "date", className, "aria-label": label, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-");
  const display = date
    ? `${year}年${Number(month)}月${Number(day)}日${time ? ` ${time}` : ""}`
    : "年 / 月 / 日";

  return (
    <span className={cn("relative block", className)}>
      <input
        {...props}
        ref={input}
        type={type}
        value={value}
        lang="zh-CN"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      <button
        type="button"
        disabled={props.disabled || props.readOnly}
        aria-label={label ? `${label}，${display}` : display}
        onClick={() => {
          const picker = input.current;
          if (picker?.showPicker) picker.showPicker();
          else picker?.click();
        }}
        className="input flex items-center justify-between gap-3 text-left"
      >
        <span className={cn("whitespace-nowrap", !value && "text-ink-3")}>{display}</span>
        <CalendarDays aria-hidden="true" size={16} className="shrink-0 text-ink-2" />
      </button>
    </span>
  );
}
