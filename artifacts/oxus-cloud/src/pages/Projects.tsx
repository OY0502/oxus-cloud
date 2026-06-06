import React, { useState } from "react";
import { projectsData } from "@/data/mock";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";

export function Projects() {
  const [selectedProject, setSelectedProject] = useState<any>(null);

  const calculateProgress = (start: string, end: string) => {
    const startDate = new Date(start).getTime();
    const endDate = new Date(end).getTime();
    // Use June 15, 2026 as the mock "today" date
    const today = new Date("2026-06-15").getTime();
    
    if (today <= startDate) return 0;
    if (today >= endDate) return 100;
    
    return Math.round(((today - startDate) / (endDate - startDate)) * 100);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Projects</h2>
          <p className="text-muted-foreground text-sm">Track active and completed projects.</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project Name</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Assignees</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead className="w-[200px]">Progress</TableHead>
              <TableHead>Deadline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectsData.map((project) => {
              const progress = calculateProgress(project.startDate, project.deadline);
              return (
                <TableRow key={project.id} onClick={() => setSelectedProject(project)} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>{project.client}</TableCell>
                  <TableCell>
                    <div className="flex -space-x-2">
                      {project.assignees.map((avatar, i) => (
                        <Avatar key={i} className="w-6 h-6 border-2 border-background">
                          <AvatarImage src={avatar} />
                          <AvatarFallback>A</AvatarFallback>
                        </Avatar>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-background">
                      {project.status.replace('-', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={project.priority === 'high' ? 'destructive' : project.priority === 'medium' ? 'secondary' : 'outline'}>
                      {project.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={progress} className="h-2 flex-1" />
                      <span className="text-xs text-muted-foreground w-8">{progress}%</span>
                    </div>
                  </TableCell>
                  <TableCell>{project.deadline}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!selectedProject} onOpenChange={() => setSelectedProject(null)}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selectedProject?.name}</SheetTitle>
            <SheetDescription>Client: {selectedProject?.client}</SheetDescription>
          </SheetHeader>
          {selectedProject && (
            <div className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Start Date</span>
                  <p className="text-sm">{selectedProject.startDate}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Deadline</span>
                  <p className="text-sm">{selectedProject.deadline}</p>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
