import React from "react";

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-cool-slate mb-2">
            {breadcrumbs.map((bc, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span>/</span>}
                {bc.href ? (
                  <a href={bc.href} className="hover:text-foreground transition-colors">{bc.label}</a>
                ) : (
                  <span className="text-foreground font-medium">{bc.label}</span>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
        <h2 className="text-3xl font-bold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="text-cool-slate mt-2">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex items-center gap-3 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
