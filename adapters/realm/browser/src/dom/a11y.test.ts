import { describe, expect, it } from 'vitest';
import { getAccessibleName, isVisible } from './a11y.js';

describe('name from content for roles that allow it', () => {
  // A segmented filter written as `<button role="radio">held</button>` is an extremely ordinary
  // design-system control. `radio` was missing from the name-from-content set, so six filters on a
  // shipments console reported as six nameless radios and `by: role` + name could not address any of
  // them — the agent had to fall back to a testid the app has no reason to carry.
  it.each(['radio', 'checkbox', 'row', 'tooltip', 'button', 'tab'])(
    'names a %s from its text content',
    (role) => {
      const el = document.createElement('div');
      el.setAttribute('role', role);
      el.textContent = 'held';
      expect(getAccessibleName(el)).toBe('held');
    },
  );

  it('still prefers an explicit aria-label over content', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-label', 'status: held');
    el.textContent = 'held';
    expect(getAccessibleName(el)).toBe('status: held');
  });
});

describe('aria-hidden decoration inside a label', () => {
  /**
   * The name we REPORT must be a name the agent can then MATCH on.
   *
   * `by: role` matching must use this same computed name. A previous split implementation excluded
   * `aria-hidden` subtrees while this function read the label's raw `textContent`, so MUI's
   * required-field marker (`<span aria-hidden="true"> *</span>`) made us report `"Username *"` for
   * a field that was only addressable as `"Username"`.
   *
   * Measured on the react-admin demo login form: `reticle_query` reported the textbox as
   * `name: "Username *"`, and querying that exact string back returned ZERO elements while
   * `"Username"` returned one. An agent that reads a name out of a snapshot and uses it — the whole
   * point of reporting names — got nothing, on a pattern every Material UI form emits.
   */
  it('ignores an aria-hidden required marker, matching the spec-computed name', () => {
    const label = document.createElement('label');
    label.htmlFor = 'u';
    label.append('Username');
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = ' *';
    label.append(marker);
    const input = document.createElement('input');
    input.id = 'u';
    document.body.append(label, input);
    try {
      expect(getAccessibleName(input)).toBe('Username');
    } finally {
      label.remove();
      input.remove();
    }
  });

  /**
   * The path that actually runs for Material UI, and the one the first fix missed.
   *
   * `getAccessibleName` tries `aria-labelledby` BEFORE the `labels` collection, and MUI's TextField
   * links its label that way — so patching the labels path alone changed nothing on the real app, and
   * the fix looked applied while the symptom persisted. Verified against the installed MUI source:
   * `FormLabel` renders its required marker as `<span aria-hidden="true">{'\u2009'}*</span>`.
   */
  it('ignores an aria-hidden marker reached through aria-labelledby', () => {
    const label = document.createElement('label');
    label.id = 'lbl';
    label.append('Username');
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = '\u2009*';
    label.append(marker);
    const input = document.createElement('input');
    input.setAttribute('aria-labelledby', 'lbl');
    document.body.append(label, input);
    try {
      expect(getAccessibleName(input)).toBe('Username');
    } finally {
      label.remove();
      input.remove();
    }
  });

  it('ignores aria-hidden content when naming from content too', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'button');
    el.append('Save');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ' ✓';
    el.append(icon);
    expect(getAccessibleName(el)).toBe('Save');
  });
});

describe('a closed native <details> hides what the summary does not contain', () => {
  /**
   * Reported from the field on more than one stack: a control inside a CLOSED `<details>` was
   * reported `visible`, so the click that expands the `<summary>` returned `already_true` /
   * no-fault, and the verdict was lost rather than the reading merely being wrong. A closed
   * `<details>` unrenders its content without setting `display:none` on it, and in some engines
   * the content keeps a layout box, so a check built from aria-hidden/[hidden]/display/
   * visibility/opacity alone cannot see it. Only the first `<summary>` child stays on screen.
   */
  it('reports the summary visible and the content hidden while closed', () => {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Connection status and setup';
    const heading = document.createElement('h2');
    heading.textContent = 'Connected';
    details.append(summary, heading);
    document.body.append(details);
    try {
      expect(isVisible(summary)).toBe(true); // the disclosure control itself still renders
      expect(isVisible(heading)).toBe(false);
      expect(isVisible(details)).toBe(true);
    } finally {
      details.remove();
    }
  });

  it('keeps content without a summary child hidden while closed', () => {
    const details = document.createElement('details');
    const heading = document.createElement('h2');
    heading.textContent = 'Connected';
    details.append(heading);
    document.body.append(details);
    try {
      expect(isVisible(heading)).toBe(false);
    } finally {
      details.remove();
    }
  });

  it('reports the content visible once the details is open', () => {
    const details = document.createElement('details');
    details.setAttribute('open', '');
    const summary = document.createElement('summary');
    summary.textContent = 'Connection status and setup';
    const heading = document.createElement('h2');
    heading.textContent = 'Connected';
    details.append(summary, heading);
    document.body.append(details);
    try {
      expect(isVisible(heading)).toBe(true);
    } finally {
      details.remove();
    }
  });

  it('keeps content hidden when a nesting ancestor is the closed details', () => {
    // An inner details that is itself OPEN still renders nothing when its outer details is
    // closed and the inner one sits in the outer's content rather than its summary.
    const outer = document.createElement('details');
    const outerSummary = document.createElement('summary');
    outerSummary.textContent = 'outer';
    const inner = document.createElement('details');
    inner.setAttribute('open', '');
    const innerSummary = document.createElement('summary');
    innerSummary.textContent = 'inner';
    const heading = document.createElement('h2');
    heading.textContent = 'Connected';
    inner.append(innerSummary, heading);
    outer.append(outerSummary, inner);
    document.body.append(outer);
    try {
      expect(isVisible(innerSummary)).toBe(false);
      expect(isVisible(heading)).toBe(false);
    } finally {
      outer.remove();
    }
  });
});
