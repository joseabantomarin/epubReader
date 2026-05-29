import styles from './PitchSection.module.css';

export default function PitchSection() {
  return (
    <div className={styles.wrap}>
      <aside className={styles.pitch}>
        <h2 className={styles.pitchTitle}>¿Te gustó esta app?</h2>
        <p className={styles.pitchBody}>
          Desarrollo software a medida — webs, apps móviles, automatizaciones, IA.
          Cuéntame tu idea y la convertimos en producto.
        </p>
        <a
          className={styles.pitchCta}
          href="mailto:joseabantomarin@gmail.com?subject=Cotización%20de%20proyecto"
        >
          Cotizar mi proyecto →
        </a>
        <p className={styles.pitchSign}>José Abanto · Desarrollador full-stack</p>
      </aside>

      <a className={styles.siteLink} href="https://openlinks.app" target="_blank" rel="noopener noreferrer">
        Conoce más en openlinks.app <span aria-hidden>↗</span>
      </a>
    </div>
  );
}
