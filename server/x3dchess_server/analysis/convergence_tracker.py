"""
Convergence Tracker - Multi-Game Analysis and Pattern Detection

Analyzes relationships between multiple concurrent games:
- Tracks eval positions across all games
- Identifies games converging to similar outcomes
- Detects outlier games with divergent trajectories
- Computes convergence scores between game pairs
"""
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass, field
import numpy as np
from collections import defaultdict


@dataclass
class GameTrajectory:
    """
    Tracks a single game's evaluation trajectory

    Attributes:
        game_id: Unique game identifier
        eval_history: List of evaluation scores over time
        move_count: Current number of moves
        current_eval: Most recent evaluation
        trend: 'rising', 'falling', 'stable'
    """
    game_id: str
    eval_history: List[float] = field(default_factory=list)
    move_count: int = 0
    current_eval: float = 0.0
    trend: str = 'stable'

    def add_eval(self, eval_score: float):
        """Add a new evaluation to the trajectory"""
        self.eval_history.append(eval_score)
        self.current_eval = eval_score
        self.move_count += 1
        self._update_trend()

    def _update_trend(self):
        """Update trend based on recent evals"""
        if len(self.eval_history) < 5:
            self.trend = 'stable'
            return

        # Compare last 5 evals
        recent = self.eval_history[-5:]
        avg_change = (recent[-1] - recent[0]) / len(recent)

        if avg_change > 0.1:
            self.trend = 'rising'
        elif avg_change < -0.1:
            self.trend = 'falling'
        else:
            self.trend = 'stable'

    def get_std_dev(self) -> float:
        """Calculate standard deviation of evals"""
        if len(self.eval_history) < 2:
            return 0.0
        return float(np.std(self.eval_history))

    def get_avg_eval(self) -> float:
        """Calculate average evaluation"""
        if not self.eval_history:
            return 0.0
        return float(np.mean(self.eval_history))


@dataclass
class ConvergencePair:
    """
    Represents convergence analysis between two games

    Attributes:
        game_id_1: First game ID
        game_id_2: Second game ID
        convergence_score: 0-1 score (1 = identical trajectories)
        correlation: Pearson correlation of eval sequences
        eval_distance: Average absolute difference in evals
        description: Human-readable interpretation
    """
    game_id_1: str
    game_id_2: str
    convergence_score: float
    correlation: float
    eval_distance: float
    description: str

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'game_id_1': self.game_id_1,
            'game_id_2': self.game_id_2,
            'convergence_score': self.convergence_score,
            'correlation': self.correlation,
            'eval_distance': self.eval_distance,
            'description': self.description
        }


@dataclass
class OutlierAlert:
    """
    Represents an outlier game detection

    Attributes:
        game_id: The outlier game ID
        reason: Why it's an outlier
        divergence_score: How different it is (0-1, 1 = completely different)
        avg_convergence: Average convergence with other games
    """
    game_id: str
    reason: str
    divergence_score: float
    avg_convergence: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'game_id': self.game_id,
            'reason': self.reason,
            'divergence_score': self.divergence_score,
            'avg_convergence': self.avg_convergence
        }


class ConvergenceTracker:
    """
    Tracks and analyzes convergence patterns across multiple games

    Key features:
    - Real-time convergence scoring between game pairs
    - Outlier detection for divergent games
    - Pattern recognition (similar openings, tactical themes)
    """

    # Convergence thresholds
    HIGH_CONVERGENCE_THRESHOLD = 0.75
    LOW_CONVERGENCE_THRESHOLD = 0.30
    OUTLIER_THRESHOLD = 0.40

    def __init__(self):
        """Initialize the tracker"""
        self.trajectories: Dict[str, GameTrajectory] = {}
        self.convergence_matrix: Dict[Tuple[str, str], ConvergencePair] = {}
        self.outliers: List[OutlierAlert] = []

    def add_game(self, game_id: str):
        """
        Register a new game for tracking

        Args:
            game_id: Unique game identifier
        """
        if game_id not in self.trajectories:
            self.trajectories[game_id] = GameTrajectory(game_id=game_id)

    def update_eval(self, game_id: str, eval_score: float):
        """
        Update evaluation for a specific game

        Args:
            game_id: Game to update
            eval_score: New evaluation score
        """
        if game_id not in self.trajectories:
            self.add_game(game_id)

        self.trajectories[game_id].add_eval(eval_score)

        # Recalculate convergence after each update
        self._update_convergence_analysis()

    def _update_convergence_analysis(self):
        """Recalculate convergence matrix and detect outliers"""
        game_ids = list(self.trajectories.keys())

        # Calculate convergence for all pairs
        for i, game_id_1 in enumerate(game_ids):
            for game_id_2 in game_ids[i + 1:]:
                pair = self._calculate_convergence(game_id_1, game_id_2)
                self.convergence_matrix[(game_id_1, game_id_2)] = pair

        # Detect outliers
        self._detect_outliers()

    def _calculate_convergence(self, game_id_1: str, game_id_2: str) -> ConvergencePair:
        """
        Calculate convergence score between two games

        Convergence considers:
        1. Correlation of eval sequences (shape similarity)
        2. Absolute eval distance (position similarity)
        3. Trend alignment

        Returns:
            ConvergencePair with analysis results
        """
        traj_1 = self.trajectories[game_id_1]
        traj_2 = self.trajectories[game_id_2]

        # Need at least 5 moves for meaningful analysis
        if min(len(traj_1.eval_history), len(traj_2.eval_history)) < 5:
            return ConvergencePair(
                game_id_1=game_id_1,
                game_id_2=game_id_2,
                convergence_score=0.5,
                correlation=0.0,
                eval_distance=0.0,
                description="Insufficient data for analysis"
            )

        # Align sequences to same length
        min_len = min(len(traj_1.eval_history), len(traj_2.eval_history))
        evals_1 = traj_1.eval_history[-min_len:]
        evals_2 = traj_2.eval_history[-min_len:]

        # 1. Calculate correlation
        if len(evals_1) > 1:
            correlation = float(np.corrcoef(evals_1, evals_2)[0, 1])
            # Handle NaN
            correlation = 0.0 if np.isnan(correlation) else correlation
        else:
            correlation = 0.0

        # 2. Calculate average absolute difference
        eval_distance = float(np.mean([abs(e1 - e2) for e1, e2 in zip(evals_1, evals_2)]))

        # 3. Check trend alignment
        trend_bonus = 1.0 if traj_1.trend == traj_2.trend else 0.5

        # Calculate overall convergence score (0-1)
        # Higher correlation = better
        # Lower eval distance = better
        # Max expected eval distance is ~10 (very different positions)
        distance_score = max(0, 1 - (eval_distance / 10.0))
        correlation_score = (correlation + 1) / 2  # Convert from [-1, 1] to [0, 1]

        # Weighted combination
        convergence_score = (correlation_score * 0.6 + distance_score * 0.4) * trend_bonus

        # Generate description
        if convergence_score >= self.HIGH_CONVERGENCE_THRESHOLD:
            desc = f"Highly convergent games (correlation: {correlation:.2f})"
        elif convergence_score <= self.LOW_CONVERGENCE_THRESHOLD:
            desc = f"Divergent games (correlation: {correlation:.2f})"
        else:
            desc = f"Moderately convergent (correlation: {correlation:.2f})"

        return ConvergencePair(
            game_id_1=game_id_1,
            game_id_2=game_id_2,
            convergence_score=convergence_score,
            correlation=correlation,
            eval_distance=eval_distance,
            description=desc
        )

    def _detect_outliers(self):
        """Detect games with divergent trajectories"""
        if not self.convergence_matrix:
            return

        # Calculate average convergence for each game
        game_convergence = defaultdict(list)

        for (game_id_1, game_id_2), pair in self.convergence_matrix.items():
            game_convergence[game_id_1].append(pair.convergence_score)
            game_convergence[game_id_2].append(pair.convergence_score)

        # Find outliers
        self.outliers.clear()

        for game_id, scores in game_convergence.items():
            if not scores:
                continue

            avg_convergence = np.mean(scores)

            if avg_convergence < self.OUTLIER_THRESHOLD:
                # Determine reason
                traj = self.trajectories[game_id]
                if traj.get_std_dev() > 2.0:
                    reason = "Highly volatile evaluation pattern"
                elif traj.current_eval > 5:
                    reason = "Extreme white advantage"
                elif traj.current_eval < -5:
                    reason = "Extreme black advantage"
                elif traj.trend == 'rising' and avg_convergence < 0.3:
                    reason = "Unique rising trajectory"
                elif traj.trend == 'falling' and avg_convergence < 0.3:
                    reason = "Unique falling trajectory"
                else:
                    reason = "Divergent position pattern"

                alert = OutlierAlert(
                    game_id=game_id,
                    reason=reason,
                    divergence_score=1.0 - avg_convergence,
                    avg_convergence=avg_convergence
                )
                self.outliers.append(alert)

    def get_convergence_matrix(self) -> Dict[str, Dict[str, float]]:
        """
        Get convergence matrix as nested dictionary

        Returns:
            Dict mapping game_id -> game_id -> convergence_score
        """
        result = defaultdict(dict)

        for (game_id_1, game_id_2), pair in self.convergence_matrix.items():
            result[game_id_1][game_id_2] = pair.convergence_score
            result[game_id_2][game_id_1] = pair.convergence_score

        return dict(result)

    def get_top_convergent_pairs(self, count: int = 5) -> List[Dict[str, Any]]:
        """
        Get the most convergent game pairs

        Args:
            count: Number of pairs to return

        Returns:
            List of top convergent pairs as dictionaries
        """
        sorted_pairs = sorted(
            self.convergence_matrix.values(),
            key=lambda p: p.convergence_score,
            reverse=True
        )

        return [pair.to_dict() for pair in sorted_pairs[:count]]

    def get_outliers(self) -> List[Dict[str, Any]]:
        """
        Get detected outlier games

        Returns:
            List of outlier alerts as dictionaries
        """
        return [alert.to_dict() for alert in self.outliers]

    def get_summary(self) -> Dict[str, Any]:
        """
        Get summary statistics

        Returns:
            Dictionary with convergence analytics summary
        """
        if not self.convergence_matrix:
            return {
                'total_games': len(self.trajectories),
                'analyzed_pairs': 0,
                'avg_convergence': 0.0,
                'outlier_count': 0
            }

        all_scores = [pair.convergence_score for pair in self.convergence_matrix.values()]

        return {
            'total_games': len(self.trajectories),
            'analyzed_pairs': len(self.convergence_matrix),
            'avg_convergence': float(np.mean(all_scores)) if all_scores else 0.0,
            'max_convergence': float(np.max(all_scores)) if all_scores else 0.0,
            'min_convergence': float(np.min(all_scores)) if all_scores else 0.0,
            'outlier_count': len(self.outliers),
            'high_convergence_pairs': len([s for s in all_scores if s >= self.HIGH_CONVERGENCE_THRESHOLD])
        }

    def reset_game(self, game_id: str):
        """
        Reset tracking for a specific game

        Args:
            game_id: Game to reset
        """
        if game_id in self.trajectories:
            self.trajectories[game_id] = GameTrajectory(game_id=game_id)

        # Remove from convergence matrix
        keys_to_remove = [k for k in self.convergence_matrix.keys() if game_id in k]
        for key in keys_to_remove:
            del self.convergence_matrix[key]

        # Recalculate
        self._update_convergence_analysis()

    def reset_all(self):
        """Reset all tracking data"""
        self.trajectories.clear()
        self.convergence_matrix.clear()
        self.outliers.clear()
