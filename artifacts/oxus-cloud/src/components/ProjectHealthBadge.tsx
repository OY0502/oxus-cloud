import React from "react";
import { StatusBadge } from "./StatusBadge";

export function ProjectHealthBadge({ health }: { health: string }) {
  if (health === "on-track") {
    return <StatusBadge status="On Track" variant="success" />;
  }
  if (health === "at-risk") {
    return <StatusBadge status="At Risk" variant="warning" />;
  }
  if (health === "off-track") {
    return <StatusBadge status="Off Track" variant="danger" />;
  }
  return <StatusBadge status={health} />;
}
