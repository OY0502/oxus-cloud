import React, { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getProjectImageUrl, projectImagePlaceholder } from "@/lib/projectImage";

interface Props {
  projectName: string;
  imagePath: string | null;
  onImagePathChange: (path: string | null) => void;
  onFileSelected?: (file: File | null) => void;
  pendingFile?: File | null;
  disabled?: boolean;
}

export function ProjectImageField({
  projectName,
  imagePath,
  onImagePathChange,
  onFileSelected,
  pendingFile,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (pendingFile) {
      const objectUrl = URL.createObjectURL(pendingFile);
      setLocalPreview(objectUrl);
      return () => {
        cancelled = true;
        URL.revokeObjectURL(objectUrl);
      };
    }
    setLocalPreview(null);
    if (!imagePath) {
      setPreviewUrl(null);
      return;
    }
    getProjectImageUrl(imagePath).then((url) => {
      if (!cancelled) setPreviewUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [imagePath, pendingFile]);

  const displayUrl = localPreview ?? previewUrl ?? projectImagePlaceholder(projectName || "Project");

  const onPick = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    onFileSelected?.(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const clear = () => {
    onFileSelected?.(null);
    onImagePathChange(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Project image</p>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted",
            !imagePath && !pendingFile && "opacity-90",
          )}
        >
          <img src={displayUrl} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="flex flex-col gap-2 pt-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
            disabled={disabled}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            <ImagePlus className="h-3.5 w-3.5" /> Upload image
          </Button>
          {(imagePath || pendingFile) && (
            <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={clear} disabled={disabled}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
          <p className="text-xs text-muted-foreground max-w-[220px]">
            Shown on the projects list. Defaults to an initial-based placeholder when empty.
          </p>
        </div>
      </div>
    </div>
  );
}
