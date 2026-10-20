from datetime import datetime, timedelta, timezone


def calculate_next_review(quality: int, ease_factor: float, interval: int) -> dict:
    """
    Implements a forgiving SM-2 Spaced Repetition algorithm.

    Args:
        quality: Recall quality score 0-5.
                 0 = complete blackout, 5 = perfect recall.
        ease_factor: Current ease factor (e-factor). Min 1.3.
        interval: Current interval in days.

    Returns:
        A dict with new 'interval', 'ease_factor', and 'next_review_date'.
    """
    if quality < 0 or quality > 5:
        raise ValueError("quality must be between 0 and 5")

    # Adjust ease factor
    ease_factor += (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    ease_factor = max(1.3, ease_factor)
    
    # Forgiving Interval Calculation
    if quality < 3:
        # Instead of dropping to 1 day, give them a 2-day buffer
        new_interval = 2 
    else:
        if interval == 0:
            new_interval = 3  # First time studying gives a 3-day curve
        elif interval == 1 or interval == 2:
            new_interval = 6
        else:
            new_interval = round(interval * ease_factor)
            
    # Enforce a hard floor so the graph always looks elegant
    new_interval = max(2, new_interval)
    
    next_review = datetime.now(timezone.utc) + timedelta(days=new_interval)
    
    return {
        "ease_factor": round(ease_factor, 2),
        "interval": new_interval,
        "next_review_date": next_review
    }
