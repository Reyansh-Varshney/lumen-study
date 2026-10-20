import math

def calculate_new_elos(rating_a: int, rating_b: int, score_a: int, score_b: int) -> tuple[int, int]:
    """
    Calculate new Elo ratings for two players based on their scores.
    K-factor is fixed at 32.
    """
    K = 32
    
    # Map quiz scores to Elo outcomes
    if score_a > score_b:
        actual_outcome_a = 1.0
        actual_outcome_b = 0.0
    elif score_a < score_b:
        actual_outcome_a = 0.0
        actual_outcome_b = 1.0
    else:
        actual_outcome_a = 0.5
        actual_outcome_b = 0.5
        
    # Expected scores
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    expected_b = 1 / (1 + 10 ** ((rating_a - rating_b) / 400))
    
    # New ratings
    new_rating_a = round(rating_a + K * (actual_outcome_a - expected_a))
    new_rating_b = round(rating_b + K * (actual_outcome_b - expected_b))
    
    return int(new_rating_a), int(new_rating_b)
