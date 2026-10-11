import Link from "next/link";

export default function NotFound() {
  return (
    <main className="empty-soft">
      <h1>페이지를 찾을 수 없어요</h1>
      <p>주소를 확인하거나 우리의 공간으로 돌아가 주세요.</p>
      <Link className="primary-button" href="/">홈으로 이동</Link>
    </main>
  );
}
