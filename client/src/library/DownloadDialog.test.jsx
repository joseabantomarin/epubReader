import { render, screen, fireEvent } from '@testing-library/react';
import DownloadDialog from './DownloadDialog.jsx';
import { triggerDownload } from '../lib/download.js';

vi.mock('../lib/download.js', () => ({ triggerDownload: vi.fn() }));

const epub = { id: 3, title: 'Novela', format: 'epub' };

describe('DownloadDialog', () => {
  beforeEach(() => { triggerDownload.mockClear(); });

  it('cerrado no renderiza nada', () => {
    const { container } = render(<DownloadDialog open={false} book={epub} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('sin libro no renderiza nada', () => {
    const { container } = render(<DownloadDialog open book={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('ofrece original y PDF para un EPUB', () => {
    render(<DownloadDialog open book={epub} onClose={() => {}} />);
    expect(screen.getByText('EPUB (original)')).toBeTruthy();
    expect(screen.getByText('PDF (convertido)')).toBeTruthy();
    expect(screen.getByText(/puede tardar unos segundos/i)).toBeTruthy();
  });

  it('descarga el original y cierra', () => {
    const onClose = vi.fn();
    render(<DownloadDialog open book={epub} onClose={onClose} />);
    fireEvent.click(screen.getByText('EPUB (original)'));
    expect(triggerDownload).toHaveBeenCalledOnce();
    expect(triggerDownload.mock.calls[0][0]).toContain('/api/books/3/download');
    expect(triggerDownload.mock.calls[0][0]).not.toContain('download.pdf');
    expect(onClose).toHaveBeenCalled();
  });

  it('descarga el PDF convertido y cierra', () => {
    const onClose = vi.fn();
    render(<DownloadDialog open book={epub} onClose={onClose} />);
    fireEvent.click(screen.getByText('PDF (convertido)'));
    expect(triggerDownload.mock.calls[0][0]).toContain('/api/books/3/download.pdf');
    expect(onClose).toHaveBeenCalled();
  });
});
