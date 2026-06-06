import React, { useState } from "react";
import { projectsData } from "@/data/mock";
import { PageHeader } from "@/components/PageHeader";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectHealthBadge } from "@/components/ProjectHealthBadge";
import { AvatarStack } from "@/components/AvatarStack";
import { EntityDrawer } from "@/components/EntityDrawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Plus, LayoutGrid, List, CalendarDays, MoreHorizontal } from "lucide-react";

export function Projects() {
  const [selectedProject, setSelectedProject] = useState<typeof projectsData[0] | null>(null);
  const [view, setView] = useState("table");

  const calculateProgress = (start: string, end: string) => {
    const startDate = new Date(start).getTime();
    const endDate = new Date(end).getTime();
    const today = new Date("2026-06-15").getTime();
    
    if (today <= startDate) return 0;
    if (today >= endDate) return 100;
    
    return Math.round(((today - startDate) / (endDate - startDate)) * 100);
  };

  const columns = [
    {
      header: "Project Name",
      accessorKey: "name" as keyof typeof projectsData[0],
      cell: (item: any) => (
        <div className="font-medium text-foreground">
          {item.name}
          <div className="text-xs text-muted-foreground mt-0.5">{item.client}</div>
        </div>
      )
    },
    {
      header: "Status",
      accessorKey: "status" as keyof typeof projectsData[0],
      cell: (item: any) => <StatusBadge status={item.status.replace('-', ' ')} />
    },
    {
      header: "Priority",
      accessorKey: "priority" as keyof typeof projectsData[0],
      cell: (item: any) => (
        <Badge variant={item.priority === 'high' ? 'destructive' : item.priority === 'medium' ? 'secondary' : 'outline'} className="capitalize">
          {item.priority}
        </Badge>
      )
    },
    {
      header: "Assignees",
      cell: (item: any) => <AvatarStack urls={item.assignees} size="sm" />
    },
    {
      header: "Timeline",
      className: "w-[250px]",
      cell: (item: any) => {
        const progress = calculateProgress(item.startDate, item.deadline);
        return (
          <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{new Date(item.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <span className="font-medium text-foreground">{progress}%</span>
              <span>{new Date(item.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        );
      }
    },
    {
      header: "Budget",
      cell: (item: any) => (
        <span className="font-medium">
          ${item.budget.toLocaleString()}
        </span>
      )
    },
    {
      header: "Health",
      cell: (item: any) => <ProjectHealthBadge health={item.health} />
    },
    {
      header: "",
      className: "w-[50px]",
      cell: () => (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Projects" 
        subtitle="Command center for all active and upcoming projects."
        actions={
          <Button className="gap-2">
            <Plus className="h-4 w-4" /> New Project
          </Button>
        }
      />

      <Tabs value={view} onValueChange={setView} className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList className="bg-muted/50 p-1 border border-border">
            <TabsTrigger value="table" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <List className="h-4 w-4" /> Table
            </TabsTrigger>
            <TabsTrigger value="board" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <LayoutGrid className="h-4 w-4" /> Board
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2 data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <CalendarDays className="h-4 w-4" /> Timeline
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="table" className="m-0 border-none p-0 outline-none">
          <DataTable 
            data={projectsData} 
            columns={columns} 
            onRowClick={(item) => setSelectedProject(item)} 
          />
        </TabsContent>
        
        <TabsContent value="board" className="m-0 border-none p-0 outline-none">
          <div className="flex items-center justify-center h-64 border border-dashed rounded-xl bg-card/50 text-muted-foreground">
            Board view coming soon
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="m-0 border-none p-0 outline-none">
          <div className="flex items-center justify-center h-64 border border-dashed rounded-xl bg-card/50 text-muted-foreground">
            Timeline view coming soon
          </div>
        </TabsContent>
      </Tabs>

      <EntityDrawer 
        open={!!selectedProject} 
        onOpenChange={(open) => !open && setSelectedProject(null)}
        title={selectedProject?.name}
        description={`Client: ${selectedProject?.client}`}
        headerActions={
          <Button variant="outline" size="sm">Edit Project</Button>
        }
      >
        {selectedProject && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-muted-foreground">Status</span>
                <div><StatusBadge status={selectedProject.status.replace('-', ' ')} /></div>
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-muted-foreground">Health</span>
                <div><ProjectHealthBadge health={selectedProject.health} /></div>
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-muted-foreground">Priority</span>
                <div>
                  <Badge variant={selectedProject.priority === 'high' ? 'destructive' : selectedProject.priority === 'medium' ? 'secondary' : 'outline'} className="capitalize">
                    {selectedProject.priority}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-muted-foreground">Budget</span>
                <div className="font-medium text-lg">${selectedProject.budget.toLocaleString()}</div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center text-sm font-medium">
                <span>Progress Overview</span>
                <span className="text-muted-foreground">{calculateProgress(selectedProject.startDate, selectedProject.deadline)}%</span>
              </div>
              <Progress value={calculateProgress(selectedProject.startDate, selectedProject.deadline)} className="h-2" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Started: {new Date(selectedProject.startDate).toLocaleDateString()}</span>
                <span>Deadline: {new Date(selectedProject.deadline).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground border-b pb-2">Team</h3>
              <div className="flex gap-2">
                 <AvatarStack urls={selectedProject.assignees} size="md" />
              </div>
            </div>
            
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground border-b pb-2">Risk Assessment</h3>
              <p className="text-sm capitalize text-foreground font-medium flex items-center gap-2">
                <Badge variant={selectedProject.risk === 'high' ? 'destructive' : 'outline'}>{selectedProject.risk} Risk</Badge>
              </p>
            </div>
          </div>
        )}
      </EntityDrawer>
    </div>
  );
}
