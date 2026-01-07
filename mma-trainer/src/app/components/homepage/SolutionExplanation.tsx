import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SolutionExplanation() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Our Solution</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-base leading-relaxed text-muted-foreground">
          We propose a browser-based AI coaching system that leverages
          computer vision and machine learning to provide real-time, objective
          feedback on MMA techniques. This solution eliminates geographical and
          financial barriers by making professional-level coaching accessible
          through any device with a camera and web browser. The system analyzes
          movement patterns, body positioning, and technique execution in
          real-time, offering immediate corrections and performance insights that
          help athletes refine their skills independently, anytime and anywhere.
        </p>
      </CardContent>
    </Card>
  );
}

