import { render, screen } from '@testing-library/react';
import SelectionMenu from './SelectionMenu.jsx';

const pos = { x: 100, y: 100 };

describe('SelectionMenu', () => {
  it('sin canAnnotate solo muestra Dicc/IA/Copiar/Compartir', () => {
    render(<SelectionMenu pos={pos} canAnnotate={false} showAI />);
    expect(screen.getByText('Dicc.')).toBeTruthy();
    expect(screen.getByText('IA')).toBeTruthy();
    expect(screen.getByText('Copiar')).toBeTruthy();
    expect(screen.getByText('Compartir')).toBeTruthy();
    expect(screen.queryByText('Subrayar')).toBeNull();
    expect(screen.queryByText('Nota')).toBeNull();
    expect(screen.queryByText('Eliminar')).toBeNull();
  });

  it('con canAnnotate (default) muestra Subrayar y Nota', () => {
    render(<SelectionMenu pos={pos} showAI={false} />);
    expect(screen.getByText('Subrayar')).toBeTruthy();
    expect(screen.getByText('Nota')).toBeTruthy();
    expect(screen.queryByText('IA')).toBeNull();
  });

  it('con existingId muestra Eliminar y no Subrayar', () => {
    render(<SelectionMenu pos={pos} existingId={7} />);
    expect(screen.getByText('Eliminar')).toBeTruthy();
    expect(screen.queryByText('Subrayar')).toBeNull();
  });

  it('sin pos no renderiza nada', () => {
    const { container } = render(<SelectionMenu pos={null} />);
    expect(container.firstChild).toBeNull();
  });
});
