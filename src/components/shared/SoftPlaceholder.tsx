import Link from "next/link";

export function SoftPlaceholder({
  icon,
  title,
  description,
  action,
  href = "/",
}: {
  icon: string;
  title: string;
  description: string;
  action: string;
  href?: string;
}) {
  return (
    <div className="empty-soft">
      <span>{icon}</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <Link className="primary-button" href={href}>{action}</Link>
    </div>
  );
}
