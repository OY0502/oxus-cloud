import React from "react";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  showText?: boolean;
};

export function BrandLogo({
  className,
  iconClassName = "w-8 h-8",
  textClassName,
  showText = true,
}: BrandLogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt="OXUS Cloud"
        className={cn("rounded-full object-cover shrink-0", iconClassName)}
      />
      {showText && (
        <span className={cn("text-xl tracking-wide text-[#D1E8FF]", textClassName)}>
          <span className="font-bold">OXUS</span>
          <span className="font-normal"> | Cloud</span>
        </span>
      )}
    </div>
  );
}
