"""Planning arithmetic only: no model output, comparator, simulation or measured power."""
import json
import math
from pathlib import Path
from statistics import NormalDist


def calculate():
    examples = []
    for k in (1, 40):
        alpha = .05 / k
        minimum = math.ceil(math.log(alpha) / math.log(.95))
        balanced = 2 * math.ceil(minimum / 2)
        examples.append({
            'illustrativeKNotFrozen': k, 'alphaCell': alpha,
            'allSuccess20LowerBound': alpha ** (1 / 20),
            'zeroEvents20UpperBound': 1 - alpha ** (1 / 20),
            'minimumIndependentSessionsFor95pctMaximumBound': minimum,
            'balancedBootPairsPerDevicePerCacheCell': balanced,
            'maximumBoundCoverageAt20Sessions': 1 - .95 ** 20,
            'maximumBoundCoverageAtMinimum': 1 - .95 ** minimum,
            'maximumBoundCoverageOneSessionBelow': 1 - .95 ** (minimum - 1),
            'minimumAllSuccessUnitsForLowerBound90pct': math.ceil(math.log(alpha) / math.log(.9)),
        })
        assert examples[-1]['maximumBoundCoverageAtMinimum'] >= 1 - alpha
        assert examples[-1]['maximumBoundCoverageOneSessionBelow'] < 1 - alpha
        assert math.isclose(examples[-1]['allSuccess20LowerBound'] + examples[-1]['zeroEvents20UpperBound'], 1)
    alpha = .05 / 40
    z = NormalDist().inv_cdf(1-alpha) + NormalDist().inv_cdf(.8)
    grid = [{'assumedIndependentPairedBlockSD': sd, 'margin': margin,
             'approximateRequiredBlocks': math.ceil((z * sd / margin) ** 2)}
            for margin in (.005, .01, .02) for sd in (.01, .02, .05)]
    return {
        'status': 'ASSUMPTION_ONLY_PLANNING_NOT_EMPIRICAL_POWER',
        'modelRuns': 0, 'observedCandidateVariance': None, 'empiricalPowerEstablished': False,
        'formulas': {
            'allSuccessLower': 'alpha_cell**(1/n)',
            'zeroEventUpper': '1-alpha_cell**(1/n)',
            'populationP95UpperOrderRank': 'smallest k with BinomialCDF(k-1,n,.95)>=1-alpha_cell',
            'maximumCoverage': '1-.95**n',
            'sampleSizeApproximation': 'ceil(((z(1-alpha_cell)+z(.8))*sigma_delta/margin)**2)',
        },
        'examples': examples, 'illustrativeSensitivityK': 40, 'sensitivityGrid': grid,
        'limits': [
            'K=40 is illustrative, not a frozen family count.',
            'Independent common-probability Bernoulli units required for exact binomial examples.',
            'Distribution-free order-statistic bound assumes independent same-cell sessions; ties conservative.',
            'Variance grid is assumed, not measured. It ignores unequal ratio weights and dependent/overlapping slices.',
            'Minimum tail sample size does not guarantee passing a budget or valid paired-ratio bootstrap coverage.',
            'No comparator, actual rating, model inference or empirical power measurement executed.',
        ],
        'arithmeticChecks': {'boundaryMinimalityAndComplement': 'PASS', 'exampleFamilies': 2},
    }


if __name__ == '__main__':
    result = calculate()
    Path(__file__).with_name('statistical-planning-arithmetic.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
