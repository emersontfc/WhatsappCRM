import { useNavigate } from "react-router-dom";
import { Button } from "./ui/Button";
import { Card, CardContent } from "./ui/Card";
import { Zap } from "lucide-react";

export const UpgradePrompt = ({ title, description }: { title: string; description: string }) => {
  const navigate = useNavigate();
  return (
    <Card className="bg-amber-50 border-amber-200">
      <CardContent className="py-6 text-center space-y-4">
        <Zap size={32} className="mx-auto text-amber-400" />
        <h3 className="text-lg font-bold text-amber-900">{title}</h3>
        <p className="text-amber-700 max-w-md mx-auto">
          {description}
        </p>
        <Button onClick={() => navigate("/upgrade")} className="bg-amber-600 hover:bg-amber-700">
          Upgrade Agora
        </Button>
      </CardContent>
    </Card>
  );
};
