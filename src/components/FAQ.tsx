import React from 'react';
import { ChevronDown } from 'lucide-react';

interface FAQItemProps {
  question: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const FAQItem = ({ question, children, defaultOpen = false }: FAQItemProps) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-4 flex items-center justify-between text-left hover:text-primary transition-colors"
      >
        <span className="font-semibold pr-4">{question}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="pb-4 text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
};

interface FAQProps {
  title?: string;
  children: React.ReactNode;
  collapsibleThreshold?: number;
}

const FAQ = ({ title = "Frequently Asked Questions", children, collapsibleThreshold = 7 }: FAQProps) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const items = React.Children.toArray(children);
  const shouldCollapse = items.length > collapsibleThreshold;
  const visibleItems = shouldCollapse && !isExpanded ? items.slice(0, collapsibleThreshold) : items;
  const hiddenCount = items.length - collapsibleThreshold;

  return (
    <div>
      {title && <h2 className="text-2xl font-bold mb-8 text-center">{title}</h2>}
      <div>
        {visibleItems}
      </div>
      {shouldCollapse && !isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors border border-border rounded-lg"
        >
          <span>Show {hiddenCount} more questions</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

export { FAQ, FAQItem };
