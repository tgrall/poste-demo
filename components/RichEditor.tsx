"use client";

import React, { useEffect } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center justify-center w-4">{children}</span>;
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex items-center justify-center h-9 w-9 rounded-md border text-sm transition ${
        active
          ? "bg-[var(--hover)] border-[var(--accent)]"
          : "bg-transparent border-[var(--border)] hover:bg-[var(--hover)]"
      }`}
    >
      {children}
    </button>
  );
}

export default function RichEditor({
  noteId,
  content,
  onChange,
  onReady,
}: {
  noteId: string;
  content: string;
  onChange: (html: string, plainText: string) => void;
  onReady?: (editor: Editor) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: { HTMLAttributes: { class: "language-plaintext" } },
      }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "noteflow-editor min-h-[240px] focus:outline-none px-3 py-2",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getText());
    },
  });

  useEffect(() => {
    if (!editor) return;
    onReady?.(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (!editor) return;
    // Only reset content when switching notes.
    editor.commands.setContent(content || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center text-sm text-[var(--muted)]">
        Loading editor…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <ToolbarButton
          label="Bold (Ctrl+B)"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Icon>B</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Italic (Ctrl+I)"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Icon>I</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Icon>U</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough (Ctrl+Shift+X)"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Icon>S</Icon>
        </ToolbarButton>
        <div className="w-px bg-[var(--border)]" />
        <ToolbarButton
          label="Heading 1 (Ctrl+Shift+1)"
          active={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Icon>H1</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2 (Ctrl+Shift+2)"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Icon>H2</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3 (Ctrl+Shift+3)"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Icon>H3</Icon>
        </ToolbarButton>
        <div className="w-px bg-[var(--border)]" />
        <ToolbarButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <Icon>•</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Ordered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <Icon>1.</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Task list"
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <Icon>☑</Icon>
        </ToolbarButton>
        <div className="w-px bg-[var(--border)]" />
        <ToolbarButton
          label="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Icon>{"</>"}</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Icon>❝</Icon>
        </ToolbarButton>
        <ToolbarButton
          label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Icon>—</Icon>
        </ToolbarButton>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)]">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
