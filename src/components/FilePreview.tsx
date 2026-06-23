// src/components/FilePreview.tsx

export default function FilePreview({ fileName, fileUrl, onClose }: {
  fileName: string;
  fileUrl: string;
  onClose: () => void;
}) {
  const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp)$/i.test(fileName);
  const isPDF = /\.pdf$/i.test(fileName);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '80vw', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>{fileName}</h3>
          <button className="btn btn-secondary" onClick={onClose}
            style={{ fontSize: 16, padding: '4px 8px' }}>✕</button>
        </div>
        {isImage && (
          <img src={fileUrl} alt={fileName}
            style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain' }} />
        )}
        {isPDF && (
          <iframe src={fileUrl}
            style={{ width: '100%', height: '65vh', border: 'none' }} />
        )}
        {!isImage && !isPDF && (
          <p style={{ color: 'var(--muted)' }}>此文件类型不支持预览，请下载查看</p>
        )}
      </div>
    </div>
  );
}
