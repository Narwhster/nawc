import { createRoot, type Root } from "react-dom/client";
import { Command, CommandGroup, CommandItem, CommandList } from "@nawcui/components/ui/command";

export type WikiLinkOption = {
  readonly label: string;
  readonly target: string;
  readonly create: boolean;
};

type WikiLinkMenuProps = {
  readonly options: readonly WikiLinkOption[];
  readonly selected: number;
  readonly onSelect: (option: WikiLinkOption) => void;
};

function WikiLinkMenu({ options, selected, onSelect }: WikiLinkMenuProps) {
  return (
    <Command value={String(selected)} shouldFilter={false}>
      <CommandList>
        <CommandGroup>
          {options.map((option, index) => (
            <CommandItem
              key={`${option.create ? "create" : "note"}:${option.target}`}
              value={String(index)}
              onMouseDown={(event) => event.preventDefault()}
              onSelect={() => onSelect(option)}
            >
              {option.create ? `Create “${option.label}”` : option.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export type WikiLinkMenuHandle = {
  render(props: WikiLinkMenuProps): void;
  destroy(): void;
};

export function mountWikiLinkMenu(container: HTMLElement): WikiLinkMenuHandle {
  const root: Root = createRoot(container);
  return {
    render: (props) => root.render(<WikiLinkMenu {...props} />),
    destroy: () => root.unmount(),
  };
}
