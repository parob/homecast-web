/**
 * One plot geometry for every chart and strip.
 *
 * A state strip that spans the full card while the chart above it starts
 * after a Y-axis gutter cannot be compared by eye — and comparing them
 * vertically ("was it on when the temperature dropped?") is the whole point
 * of stacking them. Charts pin their axis gutter to these numbers and
 * strips inset by the same amount, so one vertical line reads across
 * every panel.
 */
export const PLOT_LEFT = 52;
export const PLOT_RIGHT = 12;
