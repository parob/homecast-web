/**
 * The feature rows: title and one sentence beside a working, basic version of
 * the feature — the share dialog, the consent page, the settings panes, the
 * HA phone, the flow editor, the chart, the deal card. Each demo keeps its
 * own state and talks to nothing.
 */
import { FEATURES } from './features';
import { DEMOS } from './demos';

export function FeatureRows() {
  return (
    <section className="border-t border-border/50 px-6">
      <div className="mx-auto max-w-5xl divide-y divide-border/50">
        {FEATURES.map((f, i) => {
          const Demo = DEMOS[f.id];
          const reversed = i % 2 === 1;
          return (
            <div key={f.id} className="grid grid-cols-1 items-center gap-6 py-10 lg:grid-cols-2 lg:gap-16">
              <div className={`flex justify-center ${reversed ? 'lg:order-2' : ''}`}>
                {Demo && <Demo />}
              </div>
              <div className={`text-center lg:text-left ${reversed ? 'lg:order-1' : ''}`}>
                <h2 className="mb-2 text-2xl font-bold">{f.title}</h2>
                <p className="leading-relaxed text-muted-foreground">{f.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
