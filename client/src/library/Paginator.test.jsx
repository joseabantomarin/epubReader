import { render, screen, fireEvent } from '@testing-library/react';
import Paginator, { Paged } from './Paginator.jsx';

describe('Paginator', () => {
  it('null con una sola página', () => {
    const { container } = render(<Paginator page={1} pageCount={1} onPage={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('página 5 de 12: 1 … 4 5 6 … 12', () => {
    render(<Paginator page={5} pageCount={12} onPage={() => {}} />);
    const texts = [...screen.getByRole('navigation').querySelectorAll('button,span')].map((el) => el.textContent);
    expect(texts).toEqual(['‹', '1', '…', '4', '5', '6', '…', '12', '›']);
    expect(screen.getByText('5').getAttribute('aria-current')).toBe('page');
  });

  it('clic en número y en flechas llama onPage', () => {
    const onPage = vi.fn();
    render(<Paginator page={2} pageCount={3} onPage={onPage} />);
    fireEvent.click(screen.getByText('3'));
    expect(onPage).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByLabelText('Página anterior'));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('extremos deshabilitados', () => {
    render(<Paginator page={1} pageCount={3} onPage={() => {}} />);
    expect(screen.getByLabelText('Página anterior').disabled).toBe(true);
    expect(screen.getByLabelText('Página siguiente').disabled).toBe(false);
  });
});

describe('Paged', () => {
  it('pinta la página y navega', () => {
    const list = Array.from({ length: 15 }, (_, i) => `L${i + 1}`);
    render(
      <Paged list={list} pageSize={10}>
        {(paged) => <ul>{paged.map((x) => <li key={x}>{x}</li>)}</ul>}
      </Paged>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByText('2'));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('L15')).toBeTruthy();
  });
});
