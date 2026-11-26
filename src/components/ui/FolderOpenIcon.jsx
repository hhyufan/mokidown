/**
 * 打开资源管理器 / 文件目录按钮的统一图标。
 * 使用项目自带的文件夹图标，跟随按钮的 currentColor。
 */
export default function FolderOpenIcon({ className, ...props }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path d="M919.68 951.68H104.32a96 96 0 0 1-96-96V169.6a96 96 0 0 1 96-96H384a94.08 94.08 0 0 1 72.96 33.92l56.96 64a31.36 31.36 0 0 0 24.32 10.88l379.52-3.84a97.28 97.28 0 0 1 96.64 96.64v576a96.64 96.64 0 0 1-94.72 100.48zM104.32 137.6a32 32 0 0 0-32 32v686.08a32 32 0 0 0 32 32h815.36a32.64 32.64 0 0 0 32.64-32v-576a32.64 32.64 0 0 0-32.64-32.64l-378.88 3.84a88.32 88.32 0 0 1-73.6-35.84l-56.32-64A33.92 33.92 0 0 0 384 137.6z" />
    </svg>
  );
}
