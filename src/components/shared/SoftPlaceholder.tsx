export function SoftPlaceholder({ icon, title, description, action }: { icon: string; title: string; description: string; action: string }) {
  return <div className="empty-soft"><span>{icon}</span><h1>{title}</h1><p>{description}</p><button className="primary-button">{action}</button></div>;
}
