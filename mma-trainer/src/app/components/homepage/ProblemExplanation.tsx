import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProblemExplanation() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The Problem</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-base leading-relaxed text-muted-foreground">
          Traditional MMA coaching faces significant limitations that hinder
          accessibility and effectiveness. Many athletes struggle with the high
          costs of personal trainers, limited availability of qualified coaches,
          and the inability to receive real-time feedback during solo practice
          sessions. Additionally, traditional coaching methods often lack
          objective, data-driven analysis of technique, making it difficult for
          athletes to identify and correct form issues independently. These
          barriers prevent many aspiring fighters from reaching their full
          potential and limit the scalability of quality coaching.
        </p>
      </CardContent>
    </Card>
  );
}

