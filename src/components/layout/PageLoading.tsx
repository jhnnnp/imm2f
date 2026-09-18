export function PageLoading() {
  return (
    <div className="page-loading" aria-busy="true" aria-label="페이지를 불러오는 중">
      <div className="page-loading-title" />
      <div className="page-loading-copy" />
      <div className="page-loading-grid">
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}
