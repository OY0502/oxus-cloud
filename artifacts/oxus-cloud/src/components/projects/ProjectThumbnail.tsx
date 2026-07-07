import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getProjectImageUrl, projectImagePlaceholder } from "@/lib/projectImage";

interface Props {
  name: string;
  imagePath: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

const sizeClass = {
  sm: "h-10 w-10 rounded-lg",
  md: "h-14 w-14 rounded-xl",
};

export function ProjectThumbnail({ name, imagePath, size = "sm", className }: Props) {
  const [url, setUrl] = useState<string>(() => projectImagePlaceholder(name));

  useEffect(() => {
    let cancelled = false;
    if (!imagePath) {
      setUrl(projectImagePlaceholder(name));
      return;
    }
    getProjectImageUrl(imagePath).then((signed) => {
      if (!cancelled) setUrl(signed ?? projectImagePlaceholder(name));
    });
    return () => {
      cancelled = true;
    };
  }, [imagePath, name]);

  return (
    <img
      src={url}
      alt=""
      className={cn("object-cover border border-border/60 bg-muted shrink-0", sizeClass[size], className)}
    />
  );
}
