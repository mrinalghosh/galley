export type ViewportId = 'full' | 'desktop' | 'laptop' | 'tablet' | 'phone';

export interface ViewportPreset {
  id: ViewportId;
  label: string;
  title: string;
  /** Frame width in CSS pixels; null fills the stage. */
  width: number | null;
}

export const VIEWPORTS: ViewportPreset[] = [
  { id: 'full', label: 'Full', title: 'Full width', width: null },
  { id: 'desktop', label: '1440', title: 'Desktop, 1440px', width: 1440 },
  { id: 'laptop', label: '1280', title: 'Laptop, 1280px', width: 1280 },
  { id: 'tablet', label: '834', title: 'Tablet, 834px', width: 834 },
  { id: 'phone', label: '390', title: 'Phone, 390px', width: 390 },
];

export function viewportWidth(id: ViewportId): number | null {
  return VIEWPORTS.find((preset) => preset.id === id)?.width ?? null;
}
