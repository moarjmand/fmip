"""The baseline match probability model (T-061, blueprint 6.2).

A time-weighted Poisson score model in the Dixon-Coles family: each team has
an attack and a defence strength, there is a home advantage, and a low-score
correction ``rho`` repairs the independence assumption where it fails most
(0-0, 1-0, 0-1, 1-1). Recent matches count for more through an exponential
time decay. Club Elo enters as a prior that pulls a team's net strength toward
what its Elo implies, so a team with few recent matches is not a blank slate.

The output is a matrix of scoreline probabilities; everything the product
shows (home / draw / away, expected goals, most likely scorelines) is read off
that matrix, so the three outcome probabilities always sum to one.
"""
