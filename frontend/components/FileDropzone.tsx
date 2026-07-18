import { ChangeEvent, DragEvent, useState } from "react";

interface FileDropzoneProps {
  onFilesSelected: (files: FileList) => void;
  disabled?: boolean;
}

// Phase 3: basic click-to-pick file input.
// Phase 5c: extended with drag-and-drop support.
export default function FileDropzone({ onFilesSelected, disabled }: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onFilesSelected(event.target.files);
      event.target.value = "";
    }
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const { files } = event.dataTransfer;
    if (files && files.length > 0) {
      onFilesSelected(files);
    }
  };

  return (
    <label
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group block w-full cursor-pointer rounded border bg-term-bg px-4 py-4 text-sm transition-all duration-300 ${
        disabled
          ? "cursor-not-allowed opacity-50 border-term-border"
          : dragging
          ? "border-term-system box-shadow-glow border-solid"
          : "border-dashed border-term-border hover:border-term-action hover:box-shadow-glow"
      }`}
    >
      <input
        type="file"
        multiple
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
      <div className="flex items-center gap-2 font-mono">
        <span className={`font-bold text-shadow-glow ${dragging ? "text-term-system" : "text-term-action"}`}>{">"}</span>
        <span
          className={`transition-colors ${
            disabled
              ? "text-term-dim"
              : dragging
              ? "text-term-system text-shadow-glow"
              : "text-term-fg group-hover:text-term-action group-hover:text-shadow-glow"
          }`}
        >
          {disabled
            ? "waiting_for_connection..."
            : dragging
            ? "drop_file(s)_here..."
            : "drag_&_drop  or  click_to_select"}
        </span>
        {!dragging && <span className="w-2 h-4 bg-term-action animate-blink inline-block" />}
      </div>
    </label>
  );
}