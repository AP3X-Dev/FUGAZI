export interface ButtonProps {
  readonly label: string;
}

export function Button(props: ButtonProps): JSX.Element {
  return { type: 'button', props } as unknown as JSX.Element;
}
