"""Known chess answers precede cross-language parity; neither proves engine strength."""
import math
import unittest
import chess
from x3dchess_server.analysis.tactical_detector import TacticalDetector
from x3dchess_server.analysis.bifurcation_detector import BifurcationDetector
from x3dchess_server.analysis.phase_space import PhaseSpaceAnalyzer
from x3dchess_server.analysis.draw_detector import DrawDetector, DrawType


class AnalysisMeaning(unittest.TestCase):
    def setUp(self):self.detector=TacticalDetector()
    def board(self,fen):
        b=chess.Board(fen);self.assertTrue(b.is_valid(),fen);return b
    def motifs(self,b,kind):return [m.to_dict() for m in self.detector.detect_all_patterns(b) if m.pattern.value==kind]

    def test_both_colors_existing_knight_fork_is_not_a_proven_win(self):
        b=self.board('2q3k1/4N3/8/8/8/8/8/6K1 b - - 0 1')
        fork=self.motifs(b,'fork')[0]
        self.assertEqual(fork['piece_square'],'e7');self.assertEqual(fork['target_squares'],['c8','g8'])
        self.assertEqual(fork['severity'],'candidate');self.assertEqual(fork['piece_color'],'white')

    def test_absolute_pin_matches_rule_oracle_and_keeps_attack_semantics(self):
        b=self.board('4k3/4n3/8/8/8/8/8/K3R3 w - - 0 1')
        self.assertTrue(b.is_pinned(chess.BLACK,chess.E7))
        pin=self.motifs(b,'pin')[0]
        self.assertEqual((pin['piece_square'],pin['target_squares'],pin['status']),('e1',['e7','e8'],'absolute_pin'))
        self.assertTrue(b.is_attacked_by(chess.BLACK,chess.F5))
        b.turn=chess.BLACK
        self.assertFalse(any(m.from_square==chess.E7 for m in b.legal_moves))

    def test_wrong_direction_blockers_and_slider_type_do_not_create_pins(self):
        for fen in ['4k3/8/8/4R3/8/8/4n3/K7 b - - 0 1',
                    '4k3/8/4n3/8/4p3/8/8/4R1K1 w - - 0 1',
                    '4k3/4n3/8/8/8/8/8/4B1K1 w - - 0 1']:
            self.assertEqual(self.motifs(self.board(fen),'pin'),[])

    def test_pinned_knight_does_not_become_a_capture_fork(self):
        b=self.board('k3r3/8/8/8/3q4/6r1/4N3/4K3 w - - 0 1')
        self.assertTrue(b.is_pinned(chess.WHITE,chess.E2))
        self.assertFalse(any(m['piece_square']=='e2' for m in self.motifs(b,'fork')))

    def test_discovery_has_legal_moves_and_the_named_slider_really_checks(self):
        b=self.board('4k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1');before=b.fen()
        found=self.motifs(b,'discovery');self.assertEqual(len(found),1);m=found[0]
        self.assertEqual((m['piece_square'],m['revealed_square'],m['status']),('e4','e1','legal_move_witness'))
        self.assertTrue(m['witness_moves'])
        for text in m['witness_moves']:
            probe=b.copy();move=chess.Move.from_uci(text);self.assertIn(move,probe.legal_moves);probe.push(move)
            self.assertTrue(probe.is_check());self.assertIn(chess.E1,probe.checkers())
        self.assertEqual(b.fen(),before)

    def test_other_blocker_or_wrong_slider_rejects_false_discovery(self):
        for fen in ['4k3/8/4p3/8/4B3/8/8/4R1K1 w - - 0 1',
                    '4k3/8/8/8/4B3/8/8/4B1K1 w - - 0 1']:
            self.assertEqual(self.motifs(self.board(fen),'discovery'),[])

    def test_legal_en_passant_can_uncover_a_two_blocker_rook_check(self):
        b=self.board('8/8/8/R2pP2k/8/8/8/7K w - d6 0 1')
        m=self.motifs(b,'discovery')[0]
        self.assertEqual((m['revealed_square'],m['witness_moves']),('a5',['e5d6']))
        b.push_uci('e5d6');self.assertIn(chess.A5,b.checkers())

    def test_skewer_is_bounded_geometry_and_overload_is_not_guessed(self):
        b=self.board('r6k/8/8/8/q7/8/8/R5K1 w - - 0 1')
        m=self.motifs(b,'skewer')[0]
        self.assertEqual(m['target_squares'],['a4','a8']);self.assertEqual(m['status'],'geometric_candidate')
        self.assertEqual(self.detector.detect_overloading(chess.Board()),[])

    def test_edge_king_shield_counts_real_files_once(self):
        b=self.board('4k3/8/8/8/8/8/8/K7 w - - 0 1')
        analyzer=PhaseSpaceAnalyzer()
        self.assertEqual(analyzer._calculate_side_king_safety(b,chess.WHITE),4.0)
        self.assertEqual(analyzer._calculate_side_king_safety(b,chess.BLACK),3.5)
        self.assertEqual(analyzer.analyze_position('edge',b.fen(),0).king_safety,.5)

    def test_evaluation_changes_are_neutral_and_bound_to_current_sample(self):
        b=chess.Board();start=b.fen();b.push_san('e4');after=b.fen()
        for score in (2.0,-2.0):
            d=BifurcationDetector();d.add_position(0,0,'start',start);d.add_position(1,score,'e4',after)
            m=d.get_latest_critical_moment()
            self.assertEqual(m.severity,'large_swing');self.assertEqual(m.fen,after)
            self.assertIn('move quality is not established',m.description)
        with self.assertRaises(ValueError):d.add_position(1,0,'duplicate',after)
        for bad in (math.nan,math.inf,True):
            with self.assertRaises(ValueError):BifurcationDetector().add_position(0,bad,'x',start)

    def test_exchange_does_not_claim_an_exact_game_phase(self):
        b=self.board('r2qk2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1');d=BifurcationDetector()
        d.add_position(0,0,'start',b.fen())
        b.push_san('Qxd8+');d.add_position(1,.1,'Qxd8+',b.fen())
        b.push_san('Kxd8');d.add_position(2,0,'Kxd8',b.fen())
        m=d.get_latest_critical_moment();self.assertEqual(m.severity,'material_exchange')
        self.assertIn('no exact game-phase boundary',m.description)

    def test_draw_helper_respects_mate_and_insufficient_material(self):
        d=DrawDetector()
        mate=self.board('7k/6Q1/5K2/8/8/8/8/8 b - - 100 1')
        self.assertTrue(mate.is_checkmate());self.assertIsNone(d.detect_draw(mate,claim_draw=True))
        self.assertFalse(d.can_claim_draw(mate)['fifty_move_rule'])
        bare=self.board('4k3/8/8/8/8/8/8/K7 w - - 0 1')
        self.assertEqual(d.detect_draw(bare).draw_type,DrawType.INSUFFICIENT_MATERIAL)
        quiet=self.board('7k/8/8/8/8/8/R7/K7 w - - 99 1')
        self.assertTrue(d.can_claim_draw(quiet)['fifty_move_rule'])
        self.assertIsNone(d.detect_draw(quiet))
        self.assertEqual(d.detect_draw(quiet,claim_draw=True).draw_type,DrawType.FIFTY_MOVE_RULE)
        quiet.halfmove_clock=150
        self.assertEqual(d.detect_draw(quiet).draw_type,DrawType.SEVENTYFIVE_MOVE_RULE)

    def test_draw_claims_need_real_history_and_explicit_adjudication(self):
        d=DrawDetector();b=chess.Board()
        self.assertIsNone(d.detect_draw(b,[b.board_fen()]*10))
        for uci in ['g1f3','g8f6','f3g1','f6g8']*2:b.push_uci(uci)
        self.assertTrue(d.can_claim_draw(b)['threefold_repetition'])
        self.assertIsNone(d.detect_draw(b))
        self.assertEqual(d.detect_draw(b,claim_draw=True).draw_type,DrawType.THREEFOLD_REPETITION)
        without=chess.Board(b.fen());self.assertFalse(d.can_claim_draw(without)['threefold_repetition'])
        altered=chess.Board(b.fen());altered.castling_rights=0
        self.assertNotEqual(d.get_position_hash(b),d.get_position_hash(altered))
        for uci in ['g1f3','g8f6','f3g1','f6g8']*2:b.push_uci(uci)
        self.assertEqual(d.detect_draw(b).draw_type,DrawType.FIVEFOLD_REPETITION)


if __name__=='__main__':unittest.main()
