import { ChangeEvent } from "react";

interface FileDropzoneProps {
  onFilesSelected: (files: FileList) => void;
  disabled?: boolean;
}

// Phase 3: basic click-to-pick file input only. Drag-and-drop support is
// added in Phase 5.
export default function FileDropzone({ onFilesSelected, disabled }: FileDropzoneProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      onFilesSelected(event.target.files);
      // Reset so selecting the same file again later still fires onChange.
      event.target.value = "";
    }
  };

  return (
    <label className="block cursor-pointer rounded border border-dashed border-term-border px-4 py-3 text-center text-sm text-term-dim transition hover:border-term-cyan hover:text-term-cyan">
      <input
        type="file"
        multiple
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
      {disabled ? "$ waiting for connection..." : "$ select file(s) to send"}
    </label>
  );
}